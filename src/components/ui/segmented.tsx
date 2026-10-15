"use client";

import { cn } from "@/lib/utils";

/** A compact radio group rendered as a segmented control. */
function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "default",
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; disabled?: boolean }[];
  className?: string;
  size?: "default" | "sm";
  "aria-label"?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "bg-muted inline-flex w-fit max-w-full items-center gap-0.5 rounded-lg p-0.5",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 aria-checked:bg-background aria-checked:text-foreground inline-flex items-center justify-center gap-1 rounded-md px-2.5 font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-40 aria-checked:shadow-sm [&_svg]:size-3.5",
            size === "sm" ? "h-6 text-xs" : "h-7 text-sm",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export { Segmented };
