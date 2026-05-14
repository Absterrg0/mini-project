import { loadExecutionSnapshot } from "@/lib/execution-store";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function IngestionPage() {
  const { pipelines, organizations } = await loadExecutionSnapshot();
  const org = organizations[0];
  const pipeline = pipelines.find((p) => p.organizationId === org?.id);

  return (
    <div className="fade-up">
      <header className="dash-topbar">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">Ingestion</span>
        </div>
      </header>

      <div className="p-6 space-y-4">
        {pipeline ? (
          <>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3 fade-up-1">
              {[
                { label: "Events / 24h", value: pipeline.eventsProcessed24h.toLocaleString() },
                { label: "Webhook SLO", value: `${pipeline.webhookDeliveryPct}%` },
                { label: "Sync Cursor", value: pipeline.syncCursor },
              ].map((s) => (
                <Card key={s.label} className="bg-card border-border">
                  <CardContent className="p-4">
                    <p className="text-label mb-2">{s.label}</p>
                    <p className="stat-value font-mono text-lg truncate">{s.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Checks table */}
            <Card className="bg-card border-border fade-up-2">
              <CardHeader className="px-4 py-3 border-b border-border">
                <CardTitle className="text-sm font-medium">Health Checks</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Check</th>
                      <th>Detail</th>
                      <th>Latency</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pipeline.checks.map((check) => (
                      <tr key={check.id}>
                        <td className="font-medium">{check.label}</td>
                        <td className="text-muted-foreground text-xs">{check.detail}</td>
                        <td className="mono text-muted-foreground">{check.latencyMs}ms</td>
                        <td>
                          <span className={`tag ${check.status === "healthy" ? "tag-success" : check.status === "blocked" ? "tag-danger" : "tag-warning"}`}>
                            {check.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        ) : (
          <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
            No ingestion pipeline configured for this organization.
          </div>
        )}
      </div>
    </div>
  );
}
