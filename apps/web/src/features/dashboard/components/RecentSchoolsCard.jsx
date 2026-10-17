import { School } from 'lucide-react';
import {
  Card,
  CardHeader,
  LinkButton,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../components/ui';
import { formatDate } from '../../../lib/format.js';
import { SchoolStatusBadge } from '../../schools';
import { ViewAllLink } from './ViewAllLink.jsx';

/** Most recently registered schools. "View" opens the Schools area (details arrive in Phase 4). */
export function RecentSchoolsCard({ schools }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader titleAs="h2" title="Recent Schools" action={<ViewAllLink to="/schools" context="schools" />} />
      {/* The card is the frame; this wrapper only scrolls the table on narrow screens. */}
      <div role="region" aria-label="Recent schools" tabIndex={0} className="relative mt-4 overflow-x-auto border-t border-border focus-visible:outline-offset-[-2px]">
        <Table caption="Recently registered schools">
          <TableHead>
            <TableRow interactive={false}>
              <TableHeaderCell className="w-10">#</TableHeaderCell>
              <TableHeaderCell>School name</TableHeaderCell>
              <TableHeaderCell>Location</TableHeaderCell>
              <TableHeaderCell>Owner</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Registered</TableHeaderCell>
              <TableHeaderCell align="right">
                <span className="sr-only">Actions</span>
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {schools.length === 0 ? (
              <TableEmpty columns={7} icon={School} title="No schools yet" description="Newly registered schools will appear here." />
            ) : (
              schools.map((school, index) => (
                <TableRow key={school.id}>
                  <TableCell className="text-fg-muted">{index + 1}</TableCell>
                  <TableCell className="font-medium whitespace-nowrap">{school.name}</TableCell>
                  <TableCell className="whitespace-nowrap text-fg-secondary">{school.location}</TableCell>
                  <TableCell className="whitespace-nowrap text-fg-secondary">{school.ownerName ?? <><span aria-hidden="true">—</span><span className="sr-only">No owner linked</span></>}</TableCell>
                  <TableCell>
                    <SchoolStatusBadge status={school.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-fg-secondary">
                    <time dateTime={school.registeredAt}>{formatDate(school.registeredAt)}</time>
                  </TableCell>
                  <TableCell align="right">
                    <LinkButton to="/schools" size="sm" variant="outline" aria-label={`View ${school.name}`}>
                      View
                    </LinkButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
