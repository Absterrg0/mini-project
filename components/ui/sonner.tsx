"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const toastClassNames: NonNullable<ToasterProps["toastOptions"]>["classNames"] = {
  toast:
    "cn-toast group w-full items-start gap-2.5 border backdrop-blur-md shadow-lg sm:rounded-lg",
  content: "min-w-0 flex-1 !gap-1",
  title: "text-[13px] font-semibold leading-snug tracking-tight text-inherit",
  description: "text-xs font-normal leading-snug opacity-90",
  icon: "mt-0.5 shrink-0 self-start opacity-95 [&_svg]:size-4",
  closeButton:
    "top-2 right-2 left-auto translate-x-0 translate-y-0 border border-border/70 bg-background/90 opacity-70 transition-opacity hover:opacity-100",
  success: "border-emerald-500/30",
  error: "border-red-500/35",
  warning: "border-amber-500/30",
  info: "border-sky-500/30",
  loading: "border-border/80",
  default: "border-border/80",
}

const Toaster = ({ toastOptions, gap, style, ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  const baseStyle = {
    "--normal-bg": "var(--popover)",
    "--normal-text": "var(--popover-foreground)",
    "--normal-border": "var(--border)",
    "--border-radius": "var(--radius)",
    "--width": "min(calc(100vw - 2rem), 17.5rem)",
  } as React.CSSProperties

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      gap={gap ?? 10}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={{ ...baseStyle, ...style }}
      toastOptions={{
        duration: 3200,
        ...toastOptions,
        classNames: {
          ...toastClassNames,
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
