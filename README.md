# Contact Angle Workbench

A local web app for extracting contact-angle measurements from droplet images.

## Run

```powershell
python server.py
```

Open `http://127.0.0.1:8000`.

## Workflow

1. Load an image with the button or drag image files anywhere into the window.
2. Choose **Baseline** and click two points along the solid surface.
3. Choose **Trace** and drag or click along the visible droplet boundary.
4. Use the mouse wheel or zoom controls for small droplets. Right mouse drag to pan without editing traces.
5. Optionally press **T** to toggle a binary threshold view and adjust the threshold value in the workbench panel.
6. Press **Fit** to compute circle and ellipse fits and draw the contact tangents.
7. Press **Save Run** to add the measurement to the output table.
8. Repeat traces on the same image, or switch between loaded images in the output panel.
9. Delete rows or remove images as needed, then export CSV.

Measurements are kept in the browser for the current session until an image is removed or the page is refreshed.

## Contact Angle Techniques

Contact angle measurement usually starts by identifying the solid baseline and the visible liquid-air boundary. This app keeps that process user-guided: the user places the baseline, traces the droplet edge, and the backend fits the traced points in a baseline-aligned coordinate system. It currently compares circle and ellipse fits, then reports the left, right, and mean contact angles from the tangent lines where the fitted curve intersects the baseline.

This approach is useful for noisy microscope or goniometer images where full automation can choose the wrong edge. More advanced implementations could add automated edge detection, subpixel contour refinement, Young-Laplace fitting for gravity-distorted drops, calibration from known pixel-to-length scales, uncertainty estimates from repeated traces or bootstrap resampling, and batch processing across image sequences. Those additions would make the tool stronger for high-throughput or publication-grade measurements while preserving the current manual correction workflow.
