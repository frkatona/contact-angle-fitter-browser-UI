# Contact Angle Workbench

A local web app for extracting contact-angle measurements from droplet images.

## Run

```powershell
python server.py
```

Open `http://127.0.0.1:8000`.

## Workflow

1. Load an image.
2. Choose **Baseline** and click two points along the solid surface.
3. Choose **Trace** and drag or click along the visible droplet boundary.
4. Press **Fit** to compute circle and ellipse fits.
5. Press **Save Run** to add the measurement to the session table.
6. Repeat traces on the same image, then export CSV.

All measurements are kept in the browser until the page is refreshed.
