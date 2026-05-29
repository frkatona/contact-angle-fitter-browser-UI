# Contact Angle Workbench

A local web app for extracting contact-angle measurements from droplet images.

## Run

```powershell
python server.py
```

Open `http://127.0.0.1:8000`.

## Run With Docker

Build and run the app from this folder:

```bash
docker build -t contact-angle-workbench .
docker run --rm -p 8000:8000 contact-angle-workbench
```

Then open `http://localhost:8000`.

With Docker Compose:

```bash
docker compose up --build
```

## Workflow

1. Load an image with the button or drag image files anywhere into the window.
2. Choose **Baseline** and click two points along the solid surface.
3. Choose **Trace** and drag or click along the visible droplet boundary.
4. Use the mouse wheel or zoom controls for small droplets. Right mouse drag to pan without editing traces.
5. Optionally press **T** to toggle a binary threshold view and adjust the threshold value in the workbench panel.
6. Press **Fit** to compute circle and ellipse fits, draw the contact tangents, and add the measurement to the output table.
7. Repeat traces on the same image, or switch between loaded images in the output panel.
8. Rename or delete rows, remove images as needed, then export CSV.

Measurements are kept in the browser for the current session until an image is removed or the page is refreshed.

## Visualize Exported Data

The `visualize_contact_angle_data.py` script creates publication-style summary plots from CSV files exported by the workbench. It also accepts older consolidated CSVs that use columns such as `theta_c` and `sample_name`.

Install the plotting dependencies if needed:

```bash
pip install -r requirements-analysis.txt
```

Export a CSV from the app, then run:

```bash
python visualize_contact_angle_data.py --input contact-angle-session.csv
```

By default, outputs are written to `contact_angle_analysis/`. The script creates summary CSVs plus plots for contact-angle distributions, mean contact angle by group, left-right asymmetry, contact width versus angle, residuals versus angle, selected model counts, circle-versus-ellipse residuals, and numeric correlations when the required columns are available.

Grouping is automatic: the script prefers `sample_name`, `condition`, `treatment`, `label`, and then `image_name`. You can override this with any column in the CSV:

```bash
python visualize_contact_angle_data.py --input results.csv --group-by image_name
```

## Contact Angle Techniques

Contact angle measurement usually starts by identifying the solid baseline and the visible liquid-air boundary. This app keeps that process user-guided: the user places the baseline, traces the droplet edge, and the backend fits the traced points in a baseline-aligned coordinate system. It currently compares circle and ellipse fits, then reports the left, right, and mean contact angles measured through the droplet phase from the tangent lines where the fitted curve intersects the baseline.

This approach is useful for noisy microscope or goniometer images where full automation can choose the wrong edge. More advanced implementations could add automated edge detection, subpixel contour refinement, Young-Laplace fitting for gravity-distorted drops, calibration from known pixel-to-length scales, uncertainty estimates from repeated traces or bootstrap resampling, and batch processing across image sequences. Those additions would make the tool stronger for high-throughput or publication-grade measurements while preserving the current manual correction workflow.

## Fitting Methods

Let the user-selected baseline endpoints be \(\mathbf{b}_0\) and \(\mathbf{b}_1\), and let the traced droplet boundary points be \(\mathbf{p}_i\). The backend first defines a baseline-aligned coordinate frame

\[
\mathbf{u} = \frac{\mathbf{b}_1-\mathbf{b}_0}{\lVert \mathbf{b}_1-\mathbf{b}_0 \rVert},
\qquad
\mathbf{n} \perp \mathbf{u},
\]

where \(\mathbf{n}\) is chosen to point toward the traced droplet. Each trace point is transformed as

\[
x_i = (\mathbf{p}_i-\mathbf{b}_0)\cdot\mathbf{u},
\qquad
y_i = (\mathbf{p}_i-\mathbf{b}_0)\cdot\mathbf{n}.
\]

Points substantially below the baseline are discarded, so fitting is performed on the droplet-side contour. The contact line is then the local \(y=0\) axis. Both the circular and elliptical fits are computed in this local frame.

### Circular Fit

The circular model assumes the traced boundary is part of

\[
(x-c_x)^2 + (y-c_y)^2 = r^2.
\]

The implementation solves this as a linear least-squares problem by expanding the circle equation:

\[
x_i^2 + y_i^2 = 2c_x x_i + 2c_y y_i + c,
\qquad
r = \sqrt{c + c_x^2 + c_y^2}.
\]

After the first solve, radial residuals are computed as

\[
\epsilon_i = \sqrt{(x_i-c_x)^2 + (y_i-c_y)^2} - r.
\]

When enough points are available, a median absolute deviation filter removes strong outliers and the circle is refit. This makes repeated manual traces more tolerant of occasional points on glare, the needle, or the substrate.

The contact points are the intersections between the circle and the baseline:

\[
x_{L,R} = c_x \pm \sqrt{r^2-c_y^2},
\qquad
y=0.
\]

At either contact point \(x_c\), the tangent slope follows from implicit differentiation:

\[
m = -\frac{x_c-c_x}{0-c_y}.
\]

The reported contact angle is the inner angle measured through the droplet phase. With

\[
\alpha = \tan^{-1}(|m|),
\]

the app uses the left and right contact-line orientation to choose the droplet-side angle:

\[
\theta_L =
\begin{cases}
\alpha, & m \ge 0,\\
180^\circ-\alpha, & m < 0,
\end{cases}
\qquad
\theta_R =
\begin{cases}
\alpha, & m \le 0,\\
180^\circ-\alpha, & m > 0.
\end{cases}
\]

The displayed mean contact angle is

\[
\theta_C = \frac{\theta_L+\theta_R}{2}.
\]

### Elliptical Fit

The elliptical model allows the droplet contour to deviate from circular curvature:

\[
\left(\frac{x_r}{a}\right)^2 + \left(\frac{y_r}{b}\right)^2 = 1,
\]

where

\[
x_r = (x-c_x)\cos\phi + (y-c_y)\sin\phi,
\]

\[
y_r = -(x-c_x)\sin\phi + (y-c_y)\cos\phi.
\]

The fitted parameters are the center \((c_x,c_y)\), semi-axes \(a\) and \(b\), and rotation \(\phi\). The optimizer is initialized from the circular fit and the principal components of the traced points. It then minimizes the algebraic residual

\[
\epsilon_i =
\left(\frac{x_{r,i}}{a}\right)^2 +
\left(\frac{y_{r,i}}{b}\right)^2 - 1
\]

using nonlinear least squares. The semi-axes are optimized in log space so they remain positive.

Contact points are found by substituting \(y=0\) into the rotated ellipse equation and solving the resulting quadratic for \(x\). The tangent slope at a contact point is computed from the implicit curve \(F(x,y)=0\):

\[
m = \frac{dy}{dx} = -\frac{\partial F/\partial x}{\partial F/\partial y}.
\]

The same droplet-side angle convention used for the circular fit is then applied to obtain \(\theta_L\), \(\theta_R\), and \(\theta_C\). The reported eccentricity is

\[
e = \sqrt{1-\frac{\min(a,b)^2}{\max(a,b)^2}}.
\]

### Model Selection

The selected model is determined automatically after both fits are attempted. The circular fit is always computed first. The elliptical fit is available only when SciPy is installed and at least 10 trace points are present. If the elliptical optimizer fails or the fitted ellipse does not intersect the baseline, the app uses the circular fit.

When both models are available, the current selection rule is a conservative residual heuristic:

\[
\text{select ellipse if }
\sigma_{\mathrm{ellipse}} < 1.1\,\sigma_{\mathrm{circle}},
\]

otherwise select the circle. Here \(\sigma\) is the standard deviation of the model residuals returned by the backend. This rule favors the simpler circular model unless the ellipse is meaningfully better for the current trace, reducing the chance that small manual-tracing variations cause an unnecessarily complex fit to be selected.

One implementation detail is worth noting for scientific use: the circular residual is a radial distance residual in pixels, while the current ellipse residual is algebraic and dimensionless. The heuristic is therefore practical rather than a formal statistical model comparison. A future publication-grade version should compare models using a common geometric error metric, cross-validation, bootstrap uncertainty, or criteria such as AIC/BIC computed from comparable likelihood assumptions.

### sending to mac
```
docker build -t contact-angle-workbench:latest .
docker save -o contact-angle-workbench.tar contact-angle-workbench:latest
```

```
docker load -i contact-angle-workbench.tar
docker run --rm -p 8000:8000 contact-angle-workbench:latest
```

then open http://localhost:8000
