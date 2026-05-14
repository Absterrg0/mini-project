import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, ...props }, ref) => {
    return (
      <span className="relative inline-flex size-5 items-center justify-center">
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          className={cn(
            "peer size-5 cursor-pointer appearance-none rounded-sm border border-input bg-background transition-all outline-none checked:border-primary checked:bg-primary hover:border-ring focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          {...props}
        />
        <Check className="pointer-events-none absolute size-3.5 scale-0 text-primary-foreground transition-transform peer-checked:scale-100" />
      </span>
    );
  },
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
