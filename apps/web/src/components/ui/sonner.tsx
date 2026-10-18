import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useTheme } from "@/components/theme-provider"

/** Sonner themes itself from CSS variables, which React.CSSProperties doesn't declare. */
interface ToastStyle extends React.CSSProperties {
  "--normal-bg"?: string
  "--normal-text"?: string
  "--normal-border"?: string
  "--border-radius"?: string
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme()
  const style: ToastStyle = {
    "--normal-bg": "var(--popover)",
    "--normal-text": "var(--popover-foreground)",
    "--normal-border": "var(--border)",
    "--border-radius": "var(--radius)",
  }

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={style}
      {...props}
    />
  )
}

export { Toaster }
