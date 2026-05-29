from __future__ import annotations

import json
import math
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import numpy as np

try:
    from scipy.optimize import least_squares
except Exception:  # pragma: no cover - app can still run with circle fits
    least_squares = None


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"


def _json_response(handler: SimpleHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(body)


def _angle_delta(a: float, b: float) -> float:
    diff = abs((a - b + math.pi) % (2 * math.pi) - math.pi)
    return math.degrees(min(diff, math.pi - diff))


def _contact_angle_from_slope(slope: float, side: str) -> float:
    if not math.isfinite(slope):
        return 90.0
    acute = math.degrees(math.atan(abs(slope)))
    if side == "left":
        return acute if slope >= 0 else 180.0 - acute
    return acute if slope <= 0 else 180.0 - acute


def _baseline_frame(points: np.ndarray, baseline: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    p0, p1 = baseline
    axis = p1 - p0
    length = float(np.linalg.norm(axis))
    if length < 2:
        raise ValueError("Baseline points are too close together.")
    ux = axis / length
    n1 = np.array([-ux[1], ux[0]])
    n2 = -n1
    median = np.median(points - p0, axis=0)
    normal = n1 if float(np.dot(median, n1)) >= float(np.dot(median, n2)) else n2
    transformed = np.column_stack(((points - p0) @ ux, (points - p0) @ normal))
    return transformed, ux, normal


def _fit_circle(points: np.ndarray) -> dict[str, Any]:
    x = points[:, 0]
    y = points[:, 1]
    design = np.column_stack((2 * x, 2 * y, np.ones_like(x)))
    rhs = x * x + y * y
    cx, cy, c = np.linalg.lstsq(design, rhs, rcond=None)[0]
    radius = math.sqrt(max(float(c + cx * cx + cy * cy), 0.0))

    distances = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    raw_residuals = distances - radius
    median = float(np.median(raw_residuals))
    mad = float(np.median(np.abs(raw_residuals - median)))
    if mad > 1e-9 and len(points) >= 12:
        keep = np.abs(raw_residuals - median) <= max(3.5 * 1.4826 * mad, 1.5)
        if int(np.count_nonzero(keep)) >= 8 and int(np.count_nonzero(keep)) < len(points):
            return _fit_circle(points[keep])

    root = radius * radius - cy * cy
    if root <= 0:
        raise ValueError("Circle fit does not intersect the baseline.")
    span = math.sqrt(root)
    contacts = sorted([cx - span, cx + span])
    angles = []
    for side, contact_x in zip(("left", "right"), contacts):
        slope = -(contact_x - cx) / (0 - cy)
        angles.append(_contact_angle_from_slope(float(slope), side))

    return {
        "kind": "circle",
        "cx": float(cx),
        "cy": float(cy),
        "radius": float(radius),
        "contact_left": float(contacts[0]),
        "contact_right": float(contacts[1]),
        "theta_left": float(angles[0]),
        "theta_right": float(angles[1]),
        "theta_mean": float(np.mean(angles)),
        "residual_stdev": float(np.std(raw_residuals)),
        "points_used": int(len(points)),
    }


def _ellipse_intersections(params: np.ndarray) -> list[float]:
    cx, cy, log_a, log_b, phi = params
    a = math.exp(log_a)
    b = math.exp(log_b)
    cos_p = math.cos(phi)
    sin_p = math.sin(phi)
    aa = cos_p * cos_p / (a * a) + sin_p * sin_p / (b * b)
    bb = 2 * ((-cx * cos_p - cy * sin_p) * cos_p / (a * a) + (cx * sin_p - cy * cos_p) * -sin_p / (b * b))
    cc = ((-cx * cos_p - cy * sin_p) ** 2 / (a * a)) + ((cx * sin_p - cy * cos_p) ** 2 / (b * b)) - 1
    roots = np.roots([aa, bb, cc])
    return sorted(float(r.real) for r in roots if abs(float(r.imag)) < 1e-6)


def _ellipse_slope(params: np.ndarray, x: float, y: float = 0.0) -> float:
    cx, cy, log_a, log_b, phi = params
    a = math.exp(log_a)
    b = math.exp(log_b)
    cos_p = math.cos(phi)
    sin_p = math.sin(phi)
    xr = (x - cx) * cos_p + (y - cy) * sin_p
    yr = -(x - cx) * sin_p + (y - cy) * cos_p
    dfdx = 2 * xr * cos_p / (a * a) - 2 * yr * sin_p / (b * b)
    dfdy = 2 * xr * sin_p / (a * a) + 2 * yr * cos_p / (b * b)
    if abs(dfdy) < 1e-9:
        return math.inf
    return -dfdx / dfdy


def _fit_ellipse(points: np.ndarray, circle: dict[str, Any]) -> dict[str, Any] | None:
    if least_squares is None or len(points) < 10:
        return None
    x = points[:, 0]
    y = points[:, 1]
    centered = points - np.mean(points, axis=0)
    cov = np.cov(centered.T)
    values, vectors = np.linalg.eigh(cov)
    order = np.argsort(values)[::-1]
    values = values[order]
    vectors = vectors[:, order]
    phi0 = math.atan2(float(vectors[1, 0]), float(vectors[0, 0]))
    scale = np.sqrt(np.maximum(values, 1.0)) * 2.0
    initial = np.array([
        circle["cx"],
        circle["cy"],
        math.log(max(float(scale[0]), 2.0)),
        math.log(max(float(scale[1]), 2.0)),
        phi0,
    ])

    def residual(params: np.ndarray) -> np.ndarray:
        cx, cy, log_a, log_b, phi = params
        a = np.exp(log_a)
        b = np.exp(log_b)
        cos_p = np.cos(phi)
        sin_p = np.sin(phi)
        xr = (x - cx) * cos_p + (y - cy) * sin_p
        yr = -(x - cx) * sin_p + (y - cy) * cos_p
        return (xr / a) ** 2 + (yr / b) ** 2 - 1

    result = least_squares(residual, initial, max_nfev=2500)
    if not result.success:
        return None
    params = result.x
    contacts = _ellipse_intersections(params)
    if len(contacts) < 2:
        return None
    contacts = [contacts[0], contacts[-1]]
    slopes = [_ellipse_slope(params, contact) for contact in contacts]
    angles = [_contact_angle_from_slope(float(slope), side) for side, slope in zip(("left", "right"), slopes)]
    cx, cy, log_a, log_b, phi = params
    a = math.exp(log_a)
    b = math.exp(log_b)
    return {
        "kind": "ellipse",
        "cx": float(cx),
        "cy": float(cy),
        "a": float(a),
        "b": float(b),
        "phi": float(phi),
        "eccentricity": float(math.sqrt(max(0.0, 1 - min(a, b) ** 2 / max(a, b) ** 2))),
        "contact_left": float(contacts[0]),
        "contact_right": float(contacts[1]),
        "theta_left": float(angles[0]),
        "theta_right": float(angles[1]),
        "theta_mean": float(np.mean(angles)),
        "residual_stdev": float(np.std(residual(params))),
    }


def _fit_payload(payload: dict[str, Any]) -> dict[str, Any]:
    points = np.array(payload.get("points", []), dtype=float)
    baseline = np.array(payload.get("baseline", []), dtype=float)
    if points.ndim != 2 or points.shape[1] != 2 or len(points) < 6:
        raise ValueError("Trace at least 6 droplet boundary points.")
    if baseline.shape != (2, 2):
        raise ValueError("Set a baseline with exactly 2 points.")

    local, ux, normal = _baseline_frame(points, baseline)
    local = local[local[:, 1] >= -4]
    if len(local) < 6:
        raise ValueError("Droplet trace is not on the droplet side of the baseline.")

    circle = _fit_circle(local)
    ellipse = _fit_ellipse(local, circle)
    selected = ellipse if ellipse and ellipse["residual_stdev"] < circle["residual_stdev"] * 1.1 else circle
    width = selected["contact_right"] - selected["contact_left"]

    return {
        "image_name": payload.get("imageName", "image"),
        "label": payload.get("label", "Run"),
        "baseline": baseline.tolist(),
        "baseline_length_px": float(np.linalg.norm(baseline[1] - baseline[0])),
        "point_count": int(len(points)),
        "fit": selected["kind"],
        "theta_left": selected["theta_left"],
        "theta_right": selected["theta_right"],
        "theta_mean": selected["theta_mean"],
        "contact_width_px": float(width),
        "circle": circle,
        "ellipse": ellipse,
    }


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def do_POST(self) -> None:
        if self.path != "/api/fit":
            _json_response(self, 404, {"error": "Unknown endpoint."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            _json_response(self, 200, _fit_payload(payload))
        except Exception as exc:
            _json_response(self, 400, {"error": str(exc)})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}")


def main() -> None:
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), AppHandler)
    print(f"Contact Angle Workbench running at http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
