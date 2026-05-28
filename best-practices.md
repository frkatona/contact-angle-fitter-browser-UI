# Contact Angle Imaging Best Practices

Good contact angle results depend more on image quality and repeatable setup than on the fitting algorithm alone. Use the checklist below to capture images that are easy to trace and compare in Contact Angle Workbench.

## Image Capture

Use a side-view image where the droplet profile and solid surface are both clearly visible. Keep the camera level with the surface so the baseline is horizontal in the real scene, even if it is slightly tilted in the image. Avoid perspective views, top-down views, and images where the contact point is hidden by glare or shadow.

Use diffuse, even backlighting when possible. A bright background behind a darker droplet usually makes the liquid-air edge easier to see and trace. Avoid strong reflections, saturated highlights, motion blur, and low-contrast backgrounds.

Keep the droplet large enough in the frame to trace accurately, but leave visible space around both contact points. If multiple droplets are in one image, make sure they do not overlap and that each droplet has enough pixels along its edge for a meaningful fit.

Use consistent camera settings across a study: magnification, exposure, focus, lighting, and image resolution should stay fixed whenever possible. Save original images rather than screenshots of analysis software.

If physical dimensions matter, include a scale reference or calibrate the imaging setup separately. The app currently reports pixel-based widths unless later calibration is added.

## Tracing Workflow

Place the baseline along the solid-liquid interface, not along a shadow or reflection below it. When in doubt, zoom in and use repeated traces to estimate how sensitive the result is to baseline placement.

Trace the visible droplet boundary near both contact points and across the upper profile. Do not trace the solid baseline itself as part of the droplet edge. Skip obvious artifacts such as dust, glare, needle tips, or adjacent droplets.

Use the threshold view as a visual aid, not as a replacement for judgment. Thresholding can make edges easier to inspect, but contact angle fits still depend on whether the chosen points represent the physical liquid-air boundary.

Save multiple runs for the same image when the edge or baseline is ambiguous. The spread between repeated runs is often more informative than a single confident-looking value.

## Comparing Results

For each image or sample, compare left angle, right angle, and mean angle. A large left-right difference can indicate tilt, surface heterogeneity, evaporation dynamics, poor baseline placement, or an asymmetric droplet.

Use the fit residual as a quality indicator. Higher residuals can flag rough traces, distorted droplets, bad contrast, or a model mismatch. Compare residuals alongside angles rather than filtering only by angle value.

In exported CSV data, group rows by image name, sample, surface treatment, liquid, time point, or operator. Useful summary statistics include mean, median, standard deviation, interquartile range, and number of accepted traces.

Helpful visualizations include:

1. Scatter or strip plots of contact angle by sample group.
2. Box plots or violin plots for repeated images or repeated traces.
3. Paired left-right angle plots to reveal asymmetry.
4. Residual-versus-angle plots to identify questionable fits.
5. Time-series plots for spreading, evaporation, curing, or surface aging experiments.
6. Histograms of repeated measurements to check whether uncertainty is symmetric or multimodal.

For reporting, include the number of droplets, number of traces per droplet, image scale if available, fitting model, and any exclusion criteria. Keep representative annotated images alongside the exported CSV so numerical outliers can be inspected later.
