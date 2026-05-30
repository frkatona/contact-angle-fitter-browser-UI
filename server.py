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


def _young_laplace_dimensionless(theta: float, bond: float, steps: int = 220) -> np.ndarray | None:
    if not (0.05 < theta < math.pi - 0.05) or not math.isfinite(bond):
        return None

    eps = 1e-5
    psis = np.linspace(eps, theta, steps)
    state = np.array([eps, 0.5 * eps * eps], dtype=float)
    profile = np.empty((steps, 2), dtype=float)
    profile[0] = state

    def derivative(psi: float, current: np.ndarray) -> np.ndarray | None:
        r, z = float(current[0]), float(current[1])
        if r <= 0 or not math.isfinite(r) or not math.isfinite(z):
            return None
        denominator = 2.0 + bond * z - math.sin(psi) / r
        if denominator <= 1e-5 or not math.isfinite(denominator):
            return None
        return np.array([math.cos(psi) / denominator, math.sin(psi) / denominator], dtype=float)

    for index in range(1, steps):
        psi0 = float(psis[index - 1])
        psi1 = float(psis[index])
        dpsi = psi1 - psi0
        k1 = derivative(psi0, state)
        if k1 is None:
            return None
        k2 = derivative(psi0 + 0.5 * dpsi, state + 0.5 * dpsi * k1)
        if k2 is None:
            return None
        k3 = derivative(psi0 + 0.5 * dpsi, state + 0.5 * dpsi * k2)
        if k3 is None:
            return None
        k4 = derivative(psi1, state + dpsi * k3)
        if k4 is None:
            return None
        state = state + (dpsi / 6.0) * (k1 + 2 * k2 + 2 * k3 + k4)
        if not np.all(np.isfinite(state)) or state[0] <= 0 or state[1] < -1e-6:
            return None
        profile[index] = state

    profile[0] = [0.0, 0.0]
    if profile[-1, 0] <= 1e-6 or profile[-1, 1] <= 1e-6:
        return None
    return profile


def _young_laplace_samples(xc: float, scale: float, theta: float, bond: float) -> np.ndarray | None:
    dimensionless = _young_laplace_dimensionless(theta, bond)
    if dimensionless is None or scale <= 0 or not math.isfinite(scale):
        return None
    r = dimensionless[:, 0] * scale
    z = dimensionless[:, 1] * scale
    contact_z = float(z[-1])
    y = contact_z - z
    left = np.column_stack((xc - r[::-1], y[::-1]))
    right = np.column_stack((xc + r[1:], y[1:]))
    samples = np.vstack((left, right))
    if not np.all(np.isfinite(samples)):
        return None
    return samples


def _polyline_distances(points: np.ndarray, polyline: np.ndarray) -> np.ndarray:
    if len(polyline) < 2:
        return np.full(len(points), 1e6)
    starts = polyline[:-1]
    ends = polyline[1:]
    segments = ends - starts
    lengths_sq = np.sum(segments * segments, axis=1)
    lengths_sq = np.maximum(lengths_sq, 1e-12)
    distances = np.empty(len(points), dtype=float)
    for index, point in enumerate(points):
        relative = point - starts
        t = np.clip(np.sum(relative * segments, axis=1) / lengths_sq, 0.0, 1.0)
        projections = starts + t[:, None] * segments
        distances[index] = float(np.min(np.linalg.norm(projections - point, axis=1)))
    return distances


def _fit_young_laplace(points: np.ndarray, circle: dict[str, Any]) -> dict[str, Any] | None:
    if least_squares is None or len(points) < 10:
        return None

    x = points[:, 0]
    y = points[:, 1]
    x_range = max(float(np.ptp(x)), 4.0)
    y_range = max(float(np.ptp(y)), 4.0)
    half_width = max((circle["contact_right"] - circle["contact_left"]) * 0.5, x_range * 0.25, 1.0)
    theta0 = math.radians(float(np.clip(circle["theta_mean"], 12.0, 168.0)))
    scale0 = half_width / max(abs(math.sin(theta0)), 0.12)
    scale0 = float(np.clip(scale0, 0.25, max(x_range, y_range) * 12.0))
    center0 = 0.5 * (circle["contact_left"] + circle["contact_right"])
    left_hint = float(np.percentile(x, 3))
    right_hint = float(np.percentile(x, 97))

    lower = np.array([
        float(np.min(x) - x_range),
        math.log(0.1),
        math.radians(8.0),
        -4.0,
    ])
    upper = np.array([
        float(np.max(x) + x_range),
        math.log(max(x_range, y_range) * 20.0),
        math.radians(172.0),
        4.0,
    ])
    initial = np.array([center0, math.log(scale0), theta0, 0.0])
    initial = np.minimum(np.maximum(initial, lower + 1e-6), upper - 1e-6)

    def residual(params: np.ndarray) -> np.ndarray:
        xc, log_scale, theta, bond = params
        scale = math.exp(float(log_scale))
        samples = _young_laplace_samples(float(xc), scale, float(theta), float(bond))
        if samples is None:
            return np.full(len(points) + 2, 1e5)
        distances = _polyline_distances(points, samples)
        contact_penalty = np.array([
            0.25 * (samples[0, 0] - left_hint),
            0.25 * (samples[-1, 0] - right_hint),
        ])
        return np.concatenate((distances, contact_penalty))

    result = least_squares(
        residual,
        initial,
        bounds=(lower, upper),
        loss="soft_l1",
        f_scale=2.0,
        max_nfev=450,
    )
    if not result.success:
        return None

    xc, log_scale, theta, bond = result.x
    scale = math.exp(float(log_scale))
    samples = _young_laplace_samples(float(xc), scale, float(theta), float(bond))
    if samples is None:
        return None

    distances = _polyline_distances(points, samples)
    left_slope = math.tan(float(theta))
    right_slope = -math.tan(float(theta))
    angles = [
        _contact_angle_from_slope(left_slope, "left"),
        _contact_angle_from_slope(right_slope, "right"),
    ]
    apex = samples[len(samples) // 2]
    return {
        "kind": "young-laplace",
        "apex_x": float(apex[0]),
        "apex_y": float(apex[1]),
        "scale_px": float(scale),
        "bond": float(bond),
        "theta_parameter": math.degrees(float(theta)),
        "slope_left": float(left_slope) if math.isfinite(left_slope) else math.inf,
        "slope_right": float(right_slope) if math.isfinite(right_slope) else math.inf,
        "contact_left": float(samples[0, 0]),
        "contact_right": float(samples[-1, 0]),
        "theta_left": float(angles[0]),
        "theta_right": float(angles[1]),
        "theta_mean": float(np.mean(angles)),
        "residual_stdev": float(np.std(distances)),
        "residual_rms": float(math.sqrt(np.mean(distances * distances))),
        "samples": [[float(px), float(py)] for px, py in samples],
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
    try:
        young_laplace = _fit_young_laplace(local, circle)
    except Exception:
        young_laplace = None
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
        "young_laplace": young_laplace,
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
