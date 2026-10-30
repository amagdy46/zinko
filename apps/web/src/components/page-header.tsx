import { Link, type LinkProps } from "@tanstack/react-router"
import { Fragment, type ReactNode } from "react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

type BreadcrumbEntry = { label: string; to?: LinkProps["to"]; params?: LinkProps["params"] }

export function PageHeader({
  breadcrumb,
  title,
  description,
  meta,
  actions,
}: {
  breadcrumb?: ReadonlyArray<BreadcrumbEntry>
  title: string
  description?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="space-y-3">
      <div className="flex min-h-5 items-center">
        {breadcrumb && breadcrumb.length > 0 && (
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumb.map((item, index) => (
                <Fragment key={`${item.to ?? "current"}-${item.label}`}>
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {item.to ? (
                      <BreadcrumbLink asChild>
                        <Link to={item.to} params={item.params}>
                          {item.label}
                        </Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{item.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        )}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight wrap-break-word sm:text-2xl">
            {title}
          </h1>
          {description && (
            <div className="max-w-prose text-sm text-muted-foreground">{description}</div>
          )}
          {meta && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {meta}
            </div>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
