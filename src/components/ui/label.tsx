import * as React from "react";

import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Label + control + optional hint, stacked. The control is wrapped in the
 * <label> so it is associated without ids; use `group` for button groups.
 */
function Field({
  label,
  hint,
  htmlFor,
  group = false,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  group?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const caption = (
    <span className="text-sm leading-none font-medium select-none">
      {label}
    </span>
  );
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {htmlFor ? (
        <>
          <Label htmlFor={htmlFor}>{label}</Label>
          {children}
        </>
      ) : group ? (
        <div role="group" className="flex min-w-0 flex-col gap-1.5">
          {caption}
          {children}
        </div>
      ) : (
        <label className="flex min-w-0 flex-col gap-1.5">
          {caption}
          {children}
        </label>
      )}
      {hint ? (
        <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p>
      ) : null}
    </div>
  );
}

export { Label, Field };
