import { Alert, Badge, Card, CardContent, CardHeader } from '../../../components/ui';

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border-subtle py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <dt className="text-small text-fg-muted">{label}</dt>
      <dd className="break-all text-small text-fg sm:text-right">{children}</dd>
    </div>
  );
}

/**
 * Storage Configuration (read only): where backups are kept, what they cover and how the server is
 * configured. Values are set in the server's environment, never here; the API key is never shown.
 */
export function StorageConfiguration({ overview }) {
  const { provider, coverage } = overview;
  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
      <Card as="section" aria-labelledby="storage-provider">
        <CardHeader titleAs="h2" title={<span id="storage-provider">Backup provider</span>} description="Backups are Neon snapshots of the platform database branch." />
        <CardContent>
          <dl>
            <Row label="Provider">Neon (managed PostgreSQL)</Row>
            <Row label="Status">
              <Badge variant={provider.configured ? 'success' : 'error'} dot>
                {provider.configured ? 'Configured' : 'Not configured'}
              </Badge>
            </Row>
            <Row label="Neon project">{provider.projectId ?? 'Not set (NEON_PROJECT_ID)'}</Row>
            <Row label="Database branch">{provider.branchId ?? '—'}</Row>
            {provider.configuredBranchId && provider.branchMismatch && <Row label="NEON_BRANCH_ID (out of date)">{provider.configuredBranchId}</Row>}
            <Row label="API key">{provider.apiKeySet ? 'Set on the server (hidden)' : 'Not set (NEON_API_KEY)'}</Row>
            <Row label="Where backups are stored">Inside the Neon project, in the same region (encrypted at rest by Neon)</Row>
            <Row label="Download">Not available: snapshots cannot be exported as files</Row>
          </dl>
          {!provider.configured && (
            <Alert variant="warning" title="To configure" className="mt-4">
              <ol className="list-decimal space-y-1 pl-5">
                <li>In the Neon console: Project settings → API keys → create a project-scoped API key.</li>
                <li>Copy the project id (Settings → General) and the production branch id (Branches → production → id, br-…).</li>
                <li>In Vercel (API project) → Settings → Environment Variables, add NEON_API_KEY and NEON_PROJECT_ID (and NEON_BRANCH_ID, which is checked) for Production, then redeploy.</li>
                <li>Never paste the key into chat, Git or this page. Full steps: docs/data-backup/environment-configuration.md.</li>
              </ol>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card as="section" aria-labelledby="storage-scope">
        <CardHeader titleAs="h2" title={<span id="storage-scope">What backups cover</span>} description="A database backup is not a complete platform recovery." />
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="text-card-title text-fg">Covered</p>
            <ul className="list-disc space-y-1 pl-5 text-small text-fg-secondary">
              {coverage.covered.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-card-title text-fg">Not covered</p>
            <ul className="list-disc space-y-1 pl-5 text-small text-fg-secondary">
              {coverage.notCovered.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <p className="text-small text-fg-muted">{coverage.files}</p>
          <Alert variant="info" title="Off-site copies">
            Snapshots protect against mistakes and data damage, not against losing the Neon project or account. An encrypted off-site export (pg_dump from a scheduled runner to separate storage) is the recommended next step; see docs/data-backup/backup-architecture.md.
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
