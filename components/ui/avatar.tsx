import * as React from "react";
import { cn } from "@/lib/utils";

function Avatar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("relative flex size-10 shrink-0 overflow-hidden rounded-lg border border-border", className)} {...props} />;
}

function AvatarImage({ className, alt, src }: { className?: string; alt: string; src: string }) {
  return (
    <div
      className={cn("h-full w-full bg-cover bg-center", className)}
      role="img"
      aria-label={alt}
      style={{ backgroundImage: `url(${src})` }}
    />
  );
}

function AvatarFallback({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("grid h-full w-full place-items-center bg-muted text-sm font-semibold text-foreground", className)}>
      {children}
    </div>
  );
}

export { Avatar, AvatarImage, AvatarFallback };
