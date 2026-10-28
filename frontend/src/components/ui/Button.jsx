import "./Button.css";

const variants = ["primary", "secondary", "outline", "ghost", "danger"];
const sizes = ["sm", "md", "lg"];

export default function Button({
  children,
  onClick,
  type = "button",
  disabled = false,
  className = "",
  variant = "primary",
  size = "md",
  loading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  "aria-busy": ariaBusy,
  ...buttonProps
}) {
  const resolvedVariant = variants.includes(variant) ? variant : "primary";
  const resolvedSize = sizes.includes(size) ? size : "md";

  return (
    <button
      {...buttonProps}
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || ariaBusy || undefined}
      className={`ui-button ui-button--${resolvedVariant} ui-button--${resolvedSize}${fullWidth ? " ui-button--full-width" : ""}${className ? ` ${className}` : ""}`}
    >
      {loading && (
        <svg
          aria-hidden="true"
          className="ui-button__spinner"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="ui-button__spinner-track"
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            className="ui-button__spinner-indicator"
            d="M21 12a9 9 0 0 0-9-9"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      )}
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  );
}
