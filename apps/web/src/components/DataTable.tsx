import { ReactNode } from 'react';
import { MOBILE_MAX_QUERY } from '../design/breakpoints';
import { useMediaQuery } from '../design/useMediaQuery';
import { MobileDataCard } from './MobileDataCard';

export interface DataColumn<T> {
  key: string;
  header: string;
  numeric?: boolean;
  render?: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  caption: string;
  columns: DataColumn<T>[];
  rows: T[];
  keyOf: (row: T) => string;
  statusOf?: (row: T) => string | undefined;
  testId?: string;
}

function cellValue<T>(col: DataColumn<T>, row: T): ReactNode {
  if (col.render) {
    return col.render(row);
  }
  return (row as Record<string, unknown>)[col.key] as ReactNode;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  keyOf,
  statusOf,
  testId = 'data-table'
}: DataTableProps<T>): JSX.Element {
  const isMobile = useMediaQuery(MOBILE_MAX_QUERY);

  if (isMobile) {
    return (
      <div className="fs-md-stack" data-testid={`${testId}-cards`}>
        {rows.map((row) => (
          <MobileDataCard
            key={keyOf(row)}
            testId={`${testId}-card-${keyOf(row)}`}
            primary={cellValue(columns[0], row)}
            status={statusOf?.(row)}
            fields={columns.slice(1, 4).map((c) => ({ label: c.header, value: cellValue(c, row) }))}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="fs-table-wrap" data-testid={testId}>
      <table className="fs-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'fs-table__num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={keyOf(row)} data-testid={`${testId}-row-${keyOf(row)}`}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'fs-table__num' : undefined}>
                  {cellValue(c, row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
