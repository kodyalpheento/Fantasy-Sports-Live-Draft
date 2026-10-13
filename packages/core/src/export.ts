import { toCsv } from './csv';

export interface ExportPick {
  overall: number;
  round: number;
  pickInRound: number;
  teamName: string;
  ownerName?: string | null;
  playerId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  price: number | null;
  isKeeper: boolean;
  isAuto: boolean;
  espnId?: string | null;
  yahooId?: string | null;
}

export const EXPORT_FORMATS = ['generic', 'sleeper', 'espn', 'yahoo', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  generic: 'CSV (all details)',
  sleeper: 'Sleeper (CSV with Sleeper player IDs)',
  espn: 'ESPN (CSV with ESPN player IDs)',
  yahoo: 'Yahoo (CSV with Yahoo player IDs)',
  json: 'JSON',
};

/**
 * Build a draft-results file. None of ESPN, Sleeper or Yahoo publish an API for uploading draft results,
 * so each platform format is the pick-by-pick list in the order their "offline draft" entry screens expect,
 * carrying that platform's own player IDs so every player maps exactly.
 */
export function exportDraft(
  format: ExportFormat,
  meta: { leagueName: string; season: number; draftType: string },
  picks: ExportPick[],
): { filename: string; contentType: string; body: string } {
  const sorted = [...picks].sort((a, b) => a.overall - b.overall);
  const slug = `${meta.leagueName}-${meta.season}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const auction = meta.draftType === 'auction';

  if (format === 'json') {
    return {
      filename: `${slug}-draft.json`,
      contentType: 'application/json',
      body: JSON.stringify({ ...meta, exportedAt: new Date().toISOString(), picks: sorted }, null, 2),
    };
  }

  const csv = (header: string[], rows: unknown[][], suffix: string) => ({
    filename: `${slug}-draft-${suffix}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: toCsv(header, rows),
  });

  switch (format) {
    case 'sleeper':
      return csv(
        ['Pick', 'Round', 'Team', 'Player', 'Position', 'NFL Team', 'Sleeper Player ID', ...(auction ? ['Amount'] : []), 'Keeper'],
        sorted.map((p) => [p.overall, p.round, p.teamName, p.playerName, p.position, p.nflTeam, p.playerId,
          ...(auction ? [p.price] : []), p.isKeeper ? 'Y' : '']),
        'sleeper',
      );
    case 'espn':
      return csv(
        ['Pick', 'Round', 'Round Pick', 'Team', 'Player', 'Position', 'NFL Team', 'ESPN Player ID', ...(auction ? ['Bid'] : []), 'Keeper'],
        sorted.map((p) => [p.overall, p.round, p.pickInRound, p.teamName, p.playerName, p.position, p.nflTeam, p.espnId,
          ...(auction ? [p.price] : []), p.isKeeper ? 'Y' : '']),
        'espn',
      );
    case 'yahoo':
      return csv(
        ['Pick', 'Round', 'Team', 'Player', 'Position', 'NFL Team', 'Yahoo Player ID', ...(auction ? ['Cost'] : []), 'Keeper'],
        sorted.map((p) => [p.overall, p.round, p.teamName, p.playerName, p.position, p.nflTeam, p.yahooId,
          ...(auction ? [p.price] : []), p.isKeeper ? 'Y' : '']),
        'yahoo',
      );
    default:
      return csv(
        ['Overall', 'Round', 'Pick', 'Team', 'Owner', 'Player', 'Position', 'NFL Team', 'Price', 'Keeper', 'Autopick',
          'Sleeper ID', 'ESPN ID', 'Yahoo ID'],
        sorted.map((p) => [p.overall, p.round, p.pickInRound || '', p.teamName, p.ownerName, p.playerName, p.position,
          p.nflTeam, p.price, p.isKeeper ? 'Y' : '', p.isAuto ? 'Y' : '', p.playerId, p.espnId, p.yahooId]),
        'results',
      );
  }
}
