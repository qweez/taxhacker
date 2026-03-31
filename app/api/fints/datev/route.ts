import { getCurrentUser } from "@/lib/auth"
import { generateDatevExport } from "@/lib/fints/datev-export"
import { NextResponse } from "next/server"
import { format } from "date-fns"

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    const { searchParams } = new URL(request.url)

    const dateFrom = searchParams.get("from") ? new Date(searchParams.get("from")!) : undefined
    const dateTo = searchParams.get("to") ? new Date(searchParams.get("to")!) : undefined

    const csv = await generateDatevExport(user.id, dateFrom, dateTo)
    const filename = `EXTF_Buchungsstapel_${format(new Date(), "yyyyMMdd")}.csv`

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Export failed" }, { status: 500 })
  }
}
