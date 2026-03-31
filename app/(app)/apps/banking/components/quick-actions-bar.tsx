"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Receipt,
  Upload,
  FileText,
  Search,
} from "lucide-react"
import type { SidebarSection } from "./sidebar-nav"

export default function QuickActionsBar({
  onNavigate,
}: {
  onNavigate: (section: SidebarSection) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <Button
        size="sm"
        variant="default"
        onClick={() => onNavigate("accounts")}
        className="h-8"
      >
        <Receipt className="w-3.5 h-3.5 mr-1.5" />
        Neue Buchung
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onNavigate("receipts")}
        className="h-8"
      >
        <Upload className="w-3.5 h-3.5 mr-1.5" />
        Beleg hochladen
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onNavigate("invoices")}
        className="h-8"
      >
        <FileText className="w-3.5 h-3.5 mr-1.5" />
        Rechnung erstellen
      </Button>

      <div className="flex-1" />

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          placeholder="Transaktion suchen..."
          className="h-8 w-[180px] lg:w-[240px] pl-8 text-sm"
        />
      </div>
    </div>
  )
}
