from __future__ import annotations

import argparse
import itertools
import re
import sys
from pathlib import Path
from typing import Iterable

import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.lines import Line2D

try:
    from scipy.stats import ttest_ind
except Exception:  # pragma: no cover - optional analysis dependency
    ttest_ind = None

try:
    from statsmodels.stats.multitest import multipletests
except Exception:  # pragma: no cover - optional analysis dependency
    multipletests = None


ROOT = Path(__file__).resolve().parent
DEFAULT_INPUT = ROOT / "contact-angle-session.csv"
OUTPUT_DIR = ROOT / "contact_angle_analysis"
ALPHA = 0.05

plt.rcParams.update(
    {
        "font.size": 14,
        "axes.labelsize": 14,
        "xtick.labelsize": 12,
        "ytick.labelsize": 12,
        "legend.fontsize": 10,
        "figure.dpi": 120,
    }
)

CANONICAL_NUMERIC_COLUMNS = [
    "theta_c",
    "theta_left",
    "theta_right",
    "contact_width_px",
    "baseline_length_px",
    "point_count",
    "selected_residual_stdev",
    "circle_radius",
    "circle_residual_stdev",
    "ellipse_a",
    "ellipse_b",
    "ellipse_eccentricity",
    "ellipse_residual_stdev",
    "left_right_gap",
]

COLUMN_ALIASES = {
    "theta_c": ["theta_c", "theta_mean_deg", "theta_mean", "angle"],
    "theta_left": ["theta_left", "theta_left_deg"],
    "theta_right": ["theta_right", "theta_right_deg"],
    "contact_width_px": ["contact_width_px", "length"],
    "baseline_length_px": ["baseline_length_px"],
    "point_count": ["point_count", "points"],
    "selected_residual_stdev": ["selected_residual_stdev", "residual_stdev"],
    "circle_radius": ["circle_radius", "radius"],
    "circle_residual_stdev": ["circle_residual_stdev", "circle_stdev"],
    "ellipse_a": ["ellipse_a"],
    "ellipse_b": ["ellipse_b"],
    "ellipse_eccentricity": ["ellipse_eccentricity", "e"],
    "ellipse_residual_stdev": ["ellipse_residual_stdev", "ellipse_stdev"],
    "fit": ["fit", "selected_model"],
    "label": ["label", "measurement_id", "run"],
    "image_name": ["image_name", "file_name", "filename", "File Name"],
    "sample_name": ["sample_name", "sample", "condition", "treatment"],
}

GROUP_COLORS = [
    "#486084",
    "#913B45",
    "#448844",
    "#7B5EA7",
    "#B46A3C",
    "#387C7A",
    "#5D5D5D",
    "#B08A2E",
]


def first_available_column(df: pd.DataFrame, names: Iterable[str]) -> str | None:
    lower_to_actual = {column.lower(): column for column in df.columns}
    for name in names:
        if name in df.columns:
            return name
        actual = lower_to_actual.get(name.lower())
        if actual is not None:
            return actual
    return None


def normalize_sample_name(value: str) -> str:
    return (
        str(value)
        .strip()
        .lower()
        .replace("_", "")
        .replace("-", "")
        .replace(" ", "")
        .replace("%", "")
    )


def infer_group_from_filename(value: object) -> str:
    stem = Path(str(value)).stem
    cleaned = re.sub(r"[_-]?(run|trace|rep|repeat)?[_-]?\d+$", "", stem, flags=re.IGNORECASE)
    return cleaned or stem or "measurement"


def choose_group_column(df: pd.DataFrame, requested: str) -> pd.Series:
    if requested != "auto":
        if requested not in df.columns:
            raise ValueError(f"Requested group column '{requested}' was not found in the CSV.")
        return df[requested].fillna("unlabeled").astype(str)

    for candidate in ("sample_name", "condition", "treatment", "label"):
        if candidate in df.columns and df[candidate].nunique(dropna=True) > 1:
            return df[candidate].fillna("unlabeled").astype(str)

    if "image_name" in df.columns:
        return df["image_name"].map(infer_group_from_filename)

    return pd.Series(["all measurements"] * len(df), index=df.index)


def copy_alias(df: pd.DataFrame, target: str) -> None:
    source = first_available_column(df, COLUMN_ALIASES[target])
    if source is not None and target not in df.columns:
        df[target] = df[source]


def load_data(csv_path: Path, group_by: str) -> pd.DataFrame:
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    df = pd.read_csv(csv_path)
    if df.empty:
        raise ValueError("The CSV has no rows to visualize.")

    for target in COLUMN_ALIASES:
        copy_alias(df, target)

    if "theta_c" not in df.columns:
        raise ValueError(
            "Could not find a contact-angle column. Expected one of: "
            f"{', '.join(COLUMN_ALIASES['theta_c'])}"
        )

    for column in CANONICAL_NUMERIC_COLUMNS:
        if column in df.columns:
            df[column] = pd.to_numeric(df[column], errors="coerce")

    if "fit" not in df.columns:
        df["fit"] = "unknown"
    if "label" not in df.columns:
        df["label"] = [f"Run {index + 1}" for index in range(len(df))]
    if "image_name" not in df.columns:
        df["image_name"] = csv_path.name

    if {"theta_left", "theta_right"}.issubset(df.columns):
        df["left_right_gap"] = (df["theta_left"] - df["theta_right"]).abs()

    if {"ellipse_residual_stdev", "circle_residual_stdev"}.issubset(df.columns):
        denominator = df["circle_residual_stdev"].replace(0, pd.NA)
        df["fit_stdev_ratio"] = df["ellipse_residual_stdev"] / denominator

    df["group"] = choose_group_column(df, group_by)
    df = df.dropna(subset=["theta_c"]).copy()
    if df.empty:
        raise ValueError("No numeric contact-angle values were found after parsing the CSV.")

    return df


def color_for_group(group_name: str, index: int) -> str:
    normalized = normalize_sample_name(group_name)
    if "control" in normalized or "untreated" in normalized or "nolaser" in normalized:
        return "#448844"
    if "water" in normalized:
        return "#486084"
    if "air" in normalized:
        return "#913B45"
    return GROUP_COLORS[index % len(GROUP_COLORS)]


def ordered_groups(df: pd.DataFrame) -> list[str]:
    return df.groupby("group", dropna=False)["theta_c"].mean().sort_values(ascending=False).index.tolist()


def write_summary(df: pd.DataFrame, output_dir: Path) -> None:
    aggregations = {
        "n": ("theta_c", "count"),
        "theta_c_mean": ("theta_c", "mean"),
        "theta_c_median": ("theta_c", "median"),
        "theta_c_std": ("theta_c", "std"),
        "theta_left_mean": ("theta_left", "mean"),
        "theta_right_mean": ("theta_right", "mean"),
        "left_right_gap_mean": ("left_right_gap", "mean"),
        "contact_width_px_mean": ("contact_width_px", "mean"),
        "selected_residual_stdev_mean": ("selected_residual_stdev", "mean"),
        "circle_residual_stdev_mean": ("circle_residual_stdev", "mean"),
        "ellipse_residual_stdev_mean": ("ellipse_residual_stdev", "mean"),
        "ellipse_eccentricity_mean": ("ellipse_eccentricity", "mean"),
    }
    available = {
        name: spec
        for name, spec in aggregations.items()
        if spec[0] in df.columns
    }
    summary = (
        df.groupby("group", dropna=False)
        .agg(**available)
        .reset_index()
        .sort_values("theta_c_mean", ascending=False)
    )
    summary.to_csv(output_dir / "summary_by_group.csv", index=False)

    image_summary = (
        df.groupby(["image_name", "group"], dropna=False)
        .agg(
            n=("theta_c", "count"),
            theta_c_mean=("theta_c", "mean"),
            theta_c_std=("theta_c", "std"),
        )
        .reset_index()
        .sort_values(["group", "image_name"])
    )
    image_summary.to_csv(output_dir / "summary_by_image.csv", index=False)


def compute_pairwise_significance(df: pd.DataFrame) -> pd.DataFrame:
    if ttest_ind is None or multipletests is None:
        return pd.DataFrame()

    groups = ordered_groups(df)
    pairwise_results: list[dict[str, float | str | bool]] = []
    p_values: list[float] = []

    for group_a, group_b in itertools.combinations(groups, 2):
        values_a = df.loc[df["group"] == group_a, "theta_c"].dropna()
        values_b = df.loc[df["group"] == group_b, "theta_c"].dropna()
        if len(values_a) < 2 or len(values_b) < 2:
            continue
        statistic, p_value = ttest_ind(values_a, values_b, equal_var=False, nan_policy="omit")
        if pd.isna(p_value):
            continue
        pairwise_results.append(
            {
                "group_a": group_a,
                "group_b": group_b,
                "theta_c_mean_a": values_a.mean(),
                "theta_c_mean_b": values_b.mean(),
                "mean_difference": values_a.mean() - values_b.mean(),
                "t_statistic": statistic,
                "raw_p_value": p_value,
            }
        )
        p_values.append(float(p_value))

    if pairwise_results:
        rejected, corrected_p_values, _, _ = multipletests(p_values, alpha=ALPHA, method="holm")
        for result, reject, corrected_p in zip(pairwise_results, rejected, corrected_p_values):
            result["holm_corrected_p_value"] = corrected_p
            result["significant"] = bool(reject)
            result["not_significant"] = not bool(reject)

    return pd.DataFrame(pairwise_results)


def add_significance_bars(ax: plt.Axes, summary: pd.DataFrame, pairwise_results: pd.DataFrame) -> None:
    if pairwise_results.empty or "not_significant" not in pairwise_results.columns:
        return

    non_significant_pairs = pairwise_results.loc[pairwise_results["not_significant"]].copy()
    if non_significant_pairs.empty:
        return

    group_positions = {group: index for index, group in enumerate(summary.index)}
    bar_tops = (summary["theta_c_mean"] + summary["theta_c_std"].fillna(0)).tolist()
    y_min, y_max = ax.get_ylim()
    y_span = y_max - y_min if y_max > y_min else 1.0
    base_offset = y_span * 0.04
    step = y_span * 0.035
    line_half_width = 0.22
    active_levels: list[tuple[int, int, int]] = []

    pairs = []
    for _, row in non_significant_pairs.iterrows():
        if row["group_a"] not in group_positions or row["group_b"] not in group_positions:
            continue
        left = group_positions[row["group_a"]]
        right = group_positions[row["group_b"]]
        if left > right:
            left, right = right, left
        pairs.append((left, right))

    pairs.sort(key=lambda item: (item[1] - item[0], item[0]))
    top_needed = max(bar_tops) if bar_tops else 0

    for left, right in pairs:
        level = 0
        while any(
            not (right < active_left or left > active_right) and level == used_level
            for active_left, active_right, used_level in active_levels
        ):
            level += 1
        active_levels.append((left, right, level))
        y = top_needed + base_offset + level * step
        ax.plot(
            [left + line_half_width, right - line_half_width],
            [y, y],
            color="#555555",
            linewidth=2.0,
            solid_capstyle="butt",
        )

    if active_levels:
        max_level = max(level for _, _, level in active_levels)
        ax.set_ylim(y_min, top_needed + base_offset + (max_level + 1) * step + y_span * 0.04)


def add_significance_legend(ax: plt.Axes) -> None:
    handles = [Line2D([0], [0], color="#555555", lw=2, label="Holm p >= 0.05")]
    ax.legend(
        handles=handles,
        loc="upper right",
        frameon=True,
        framealpha=1.0,
        edgecolor="#D0D0D0",
        facecolor="white",
        fontsize=8,
        title="No significant difference",
        title_fontsize=8,
    )


def save_figure(fig: plt.Figure, output_dir: Path, filename: str) -> None:
    fig.tight_layout()
    fig.savefig(output_dir / filename, dpi=200)
    plt.close(fig)


def plot_theta_distribution(df: pd.DataFrame, output_dir: Path) -> None:
    groups = ordered_groups(df)
    data = [df.loc[df["group"] == group, "theta_c"].dropna().values for group in groups]

    fig, ax = plt.subplots(figsize=(max(8, len(groups) * 1.1), 6))
    box = ax.boxplot(data, labels=groups, patch_artist=True)
    for index, patch in enumerate(box["boxes"]):
        patch.set_facecolor(color_for_group(groups[index], index))
        patch.set_alpha(0.72)
    ax.set_ylabel(r"$\theta_C$ (deg)")
    ax.set_title("Contact angle distribution")
    ax.tick_params(axis="x", rotation=25)
    save_figure(fig, output_dir, "theta_c_boxplot.png")


def plot_summary_bars(df: pd.DataFrame, output_dir: Path) -> None:
    summary = (
        df.groupby("group", dropna=False)
        .agg(theta_c_mean=("theta_c", "mean"), theta_c_std=("theta_c", "std"), n=("theta_c", "count"))
        .sort_values("theta_c_mean", ascending=False)
    )
    pairwise_results = compute_pairwise_significance(df)
    if not pairwise_results.empty:
        pairwise_results.to_csv(output_dir / "theta_c_pairwise_significance.csv", index=False)

    colors = [color_for_group(group, index) for index, group in enumerate(summary.index)]

    fig, ax = plt.subplots(figsize=(max(8, len(summary) * 1.1), 6))
    bars = ax.bar(
        summary.index,
        summary["theta_c_mean"],
        yerr=summary["theta_c_std"],
        capsize=4,
        color=colors,
        alpha=0.92,
    )
    for bar, value, n in zip(bars, summary["theta_c_mean"], summary["n"]):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() * 0.5,
            f"{value:.1f}\nn={int(n)}",
            ha="center",
            va="center",
            color="white",
            fontsize=10,
            fontweight="bold",
        )

    add_significance_bars(ax, summary, pairwise_results)
    if not pairwise_results.empty:
        add_significance_legend(ax)
    ax.set_ylabel(r"Mean $\theta_C$ (deg)")
    ax.set_title("Mean contact angle by group")
    ax.tick_params(axis="x", rotation=25)
    save_figure(fig, output_dir, "theta_c_means.png")


def plot_left_right_gap(df: pd.DataFrame, output_dir: Path) -> None:
    if "left_right_gap" not in df.columns:
        return

    summary = df.groupby("group", dropna=False)["left_right_gap"].mean().sort_values(ascending=False)
    colors = [color_for_group(group, index) for index, group in enumerate(summary.index)]

    fig, ax = plt.subplots(figsize=(max(8, len(summary) * 1.1), 6))
    ax.bar(summary.index, summary.values, color=colors, alpha=0.92)
    ax.set_ylabel(r"Mean $|\theta_L - \theta_R|$ (deg)")
    ax.set_title("Left-right contact angle asymmetry")
    ax.tick_params(axis="x", rotation=25)
    save_figure(fig, output_dir, "left_right_asymmetry.png")


def plot_width_vs_theta(df: pd.DataFrame, output_dir: Path) -> None:
    if "contact_width_px" not in df.columns:
        return

    fig, ax = plt.subplots(figsize=(8, 6))
    for index, (group_name, group) in enumerate(df.groupby("group", dropna=False)):
        ax.scatter(
            group["contact_width_px"],
            group["theta_c"],
            label=group_name,
            s=44,
            alpha=0.78,
            color=color_for_group(group_name, index),
        )

    ax.set_xlabel("Contact width (px)")
    ax.set_ylabel(r"$\theta_C$ (deg)")
    ax.set_title("Contact width versus angle")
    ax.legend(frameon=False, fontsize=8)
    save_figure(fig, output_dir, "contact_width_vs_theta_c.png")


def plot_residual_vs_theta(df: pd.DataFrame, output_dir: Path) -> None:
    if "selected_residual_stdev" not in df.columns:
        return

    fig, ax = plt.subplots(figsize=(8, 6))
    for index, (fit_name, group) in enumerate(df.groupby("fit", dropna=False)):
        ax.scatter(
            group["selected_residual_stdev"],
            group["theta_c"],
            label=str(fit_name),
            s=44,
            alpha=0.78,
            color=GROUP_COLORS[index % len(GROUP_COLORS)],
        )

    ax.set_xlabel("Selected fit residual stdev")
    ax.set_ylabel(r"$\theta_C$ (deg)")
    ax.set_title("Fit residual versus angle")
    ax.legend(title="Model", frameon=False, fontsize=8)
    save_figure(fig, output_dir, "residual_vs_theta_c.png")


def plot_model_counts(df: pd.DataFrame, output_dir: Path) -> None:
    if "fit" not in df.columns:
        return

    counts = df["fit"].fillna("unknown").value_counts()
    fig, ax = plt.subplots(figsize=(6, 5))
    ax.bar(counts.index.astype(str), counts.values, color="#486084", alpha=0.92)
    ax.set_ylabel("Saved runs")
    ax.set_title("Selected model counts")
    save_figure(fig, output_dir, "selected_model_counts.png")


def plot_residual_comparison(df: pd.DataFrame, output_dir: Path) -> None:
    required = {"circle_residual_stdev", "ellipse_residual_stdev"}
    if not required.issubset(df.columns):
        return

    clean = df.dropna(subset=list(required))
    if clean.empty:
        return

    fig, ax = plt.subplots(figsize=(7, 7))
    for index, (group_name, group) in enumerate(clean.groupby("group", dropna=False)):
        ax.scatter(
            group["circle_residual_stdev"],
            group["ellipse_residual_stdev"],
            label=group_name,
            s=44,
            alpha=0.78,
            color=color_for_group(group_name, index),
        )

    limit = max(clean["circle_residual_stdev"].max(), clean["ellipse_residual_stdev"].max())
    ax.plot([0, limit], [0, limit], color="#555555", linewidth=1.2, linestyle="--")
    ax.set_xlabel("Circle residual stdev")
    ax.set_ylabel("Ellipse residual stdev")
    ax.set_title("Circle versus ellipse residuals")
    ax.legend(frameon=False, fontsize=8)
    save_figure(fig, output_dir, "circle_vs_ellipse_residuals.png")


def plot_correlation_heatmap(df: pd.DataFrame, output_dir: Path) -> None:
    columns = [column for column in CANONICAL_NUMERIC_COLUMNS if column in df.columns]
    columns = [column for column in columns if df[column].notna().sum() >= 2]
    if len(columns) < 2:
        return

    corr = df[columns].corr(numeric_only=True)

    fig, ax = plt.subplots(figsize=(max(8, len(columns) * 0.7), max(6, len(columns) * 0.6)))
    image = ax.imshow(corr, cmap="coolwarm", vmin=-1, vmax=1)
    ax.set_xticks(range(len(columns)), columns, rotation=35, ha="right")
    ax.set_yticks(range(len(columns)), columns)

    for i in range(len(columns)):
        for j in range(len(columns)):
            ax.text(j, i, f"{corr.iloc[i, j]:.2f}", ha="center", va="center", fontsize=8)

    fig.colorbar(image, ax=ax, shrink=0.85)
    ax.set_title("Numeric correlation matrix")
    save_figure(fig, output_dir, "correlation_heatmap.png")


def print_key_findings(df: pd.DataFrame) -> None:
    sample_summary = (
        df.groupby("group", dropna=False)
        .agg(
            n=("theta_c", "count"),
            theta_c_mean=("theta_c", "mean"),
            theta_c_std=("theta_c", "std"),
        )
        .sort_values("theta_c_mean", ascending=False)
    )

    highest = sample_summary.iloc[0]
    lowest = sample_summary.iloc[-1]

    print("Top-line findings")
    print("-----------------")
    print(f"Groups: {len(sample_summary)}")
    print(f"Saved runs: {len(df)}")
    print(f"Highest mean theta_C: {sample_summary.index[0]} ({highest['theta_c_mean']:.2f} deg)")
    print(f"Lowest mean theta_C: {sample_summary.index[-1]} ({lowest['theta_c_mean']:.2f} deg)")

    if "fit" in df.columns:
        model_counts = df["fit"].fillna("unknown").value_counts()
        print("Selected models: " + ", ".join(f"{model}={count}" for model, count in model_counts.items()))

    if "selected_residual_stdev" in df.columns:
        worst = df.loc[df["selected_residual_stdev"].idxmax()]
        print(
            "Largest residual: "
            f"{worst.get('label', 'run')} from {worst.get('image_name', 'image')} "
            f"({worst['selected_residual_stdev']:.4g})"
        )


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(
        description=(
            "Create summary plots from Contact Angle Workbench CSV exports. "
            "Older consolidated CSVs with theta_c/sample_name columns are also supported."
        )
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        help="Path to the exported CSV file.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=OUTPUT_DIR,
        help="Directory where plots and summary CSVs will be written.",
    )
    parser.add_argument(
        "--group-by",
        default="auto",
        help=(
            "Column used to group bars/boxplots. Use 'auto' to prefer sample_name, "
            "condition, treatment, label, then image_name."
        ),
    )
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    df = load_data(args.input, args.group_by)

    write_summary(df, args.output_dir)
    plot_theta_distribution(df, args.output_dir)
    plot_summary_bars(df, args.output_dir)
    plot_left_right_gap(df, args.output_dir)
    plot_width_vs_theta(df, args.output_dir)
    plot_residual_vs_theta(df, args.output_dir)
    plot_model_counts(df, args.output_dir)
    plot_residual_comparison(df, args.output_dir)
    plot_correlation_heatmap(df, args.output_dir)

    print_key_findings(df)
    print(f"\nWrote analysis outputs to {args.output_dir}")


if __name__ == "__main__":
    main()
