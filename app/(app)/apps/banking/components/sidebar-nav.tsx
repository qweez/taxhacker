"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  BarChart3,
  BookOpen,
  Building2,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Database,
  FileSpreadsheet,
  FileText,
  Link,
  Link2,
  Menu,
  PenLine,
  Receipt,
  Repeat,
  RefreshCw,
  Shield,
  TrendingUp,
} from "lucide-react"
import { useState } from "react"

export type SidebarSection =
  | "overview"
  | "accounts"
  | "booking"
  | "receipts"
  | "reconciliation"
  | "recurring"
  | "invoices"
  | "euer"
  | "ust"
  | "bwa"
  | "anlagen"
  | "open-items"
  | "ebilanz"
  | "datev"
  | "sage"
  | "erpnext"
  | "sync-settings"
  | "inflation"
  | "audit"

type NavGroup = {
  label: string
  items: {
    id: SidebarSection
    label: string
    icon: React.ComponentType<{ className?: string }>
  }[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Buchhaltung",
    items: [
      { id: "accounts", label: "Konten", icon: Building2 },
      { id: "booking", label: "Buchen", icon: PenLine },
      { id: "receipts", label: "Belege", icon: FileText },
      { id: "reconciliation", label: "Abgleich", icon: Link2 },
      { id: "recurring", label: "Daueraufträge", icon: Repeat },
    ],
  },
  {
    label: "Berichte",
    items: [
      { id: "bwa", label: "BWA", icon: BarChart3 },
      { id: "euer", label: "EÜR", icon: BookOpen },
      { id: "ust", label: "USt-Voranmeldung", icon: Calculator },
      { id: "ebilanz", label: "E-Bilanz", icon: FileSpreadsheet },
      { id: "anlagen", label: "Anlagenspiegel", icon: Building2 },
    ],
  },
  {
    label: "Exporte",
    items: [
      { id: "datev", label: "DATEV", icon: FileSpreadsheet },
      { id: "sage", label: "Sage", icon: Database },
    ],
  },
  {
    label: "Rechnungen",
    items: [
      { id: "invoices", label: "Erstellen", icon: Receipt },
      { id: "open-items", label: "Offene Posten", icon: Receipt },
    ],
  },
  {
    label: "Integrationen",
    items: [
      { id: "erpnext", label: "ERPNext", icon: Link },
      { id: "sync-settings", label: "Auto-Sync & Telegram", icon: RefreshCw },
    ],
  },
  {
    label: "Einstellungen",
    items: [
      { id: "inflation", label: "Inflation", icon: TrendingUp },
      { id: "audit", label: "Audit-Log", icon: Shield },
    ],
  },
]

function NavContent({
  activeSection,
  onSelect,
  collapsed,
}: {
  activeSection: SidebarSection
  onSelect: (section: SidebarSection) => void
  collapsed: boolean
}) {
  return (
    <TooltipProvider delayDuration={0}>
      <nav className="flex flex-col gap-1 py-2">
        {/* Overview item */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onSelect("overview")}
                className={cn(
                  "flex items-center justify-center rounded-md p-2 text-sm transition-colors mx-1",
                  activeSection === "overview"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <BarChart3 className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Übersicht</TooltipContent>
          </Tooltip>
        ) : (
          <button
            onClick={() => onSelect("overview")}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors mx-1",
              activeSection === "overview"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <BarChart3 className="h-4 w-4 shrink-0" />
            Übersicht
          </button>
        )}

        <Separator className="my-1" />

        {/* Grouped nav items */}
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-1">
            {!collapsed && (
              <p className="px-3 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                {group.label}
              </p>
            )}
            {collapsed && <Separator className="my-1" />}
            {group.items.map((item) => {
              const Icon = item.icon
              const isActive = activeSection === item.id

              if (collapsed) {
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onSelect(item.id)}
                        className={cn(
                          "flex items-center justify-center rounded-md p-2 text-sm transition-colors mx-1",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                )
              }

              return (
                <button
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors mx-1 w-[calc(100%-0.5rem)]",
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </button>
              )
            })}
          </div>
        ))}
      </nav>
    </TooltipProvider>
  )
}

export default function SidebarNav({
  activeSection,
  onSelect,
}: {
  activeSection: SidebarSection
  onSelect: (section: SidebarSection) => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <>
      {/* Mobile: Sheet drawer triggered by hamburger */}
      <div className="lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="mb-4">
              <Menu className="h-4 w-4 mr-2" />
              Navigation
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[260px] p-0 pt-10">
            <NavContent
              activeSection={activeSection}
              onSelect={onSelect}
              collapsed={false}
            />
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop: persistent sidebar */}
      <div
        className={cn(
          "hidden lg:flex flex-col border-r bg-background shrink-0 transition-all duration-200",
          collapsed ? "w-[52px]" : "w-[220px]"
        )}
      >
        {/* Collapse toggle */}
        <div className={cn("flex items-center p-2", collapsed ? "justify-center" : "justify-end")}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title={collapsed ? "Sidebar einblenden" : "Sidebar ausblenden"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <NavContent
            activeSection={activeSection}
            onSelect={onSelect}
            collapsed={collapsed}
          />
        </div>
      </div>
    </>
  )
}
