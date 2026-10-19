import { formatRange, formatShort } from '../../domain/dates';
import type { GapExplanation } from '../../domain/forecast';
import { formatMoney } from '../../domain/money';

/** An amount that never breaks across lines between its sign and its digits. */
export const Money = ({ cents }: { cents: number }) => <span className="nowrap">{formatMoney(cents)}</span>;

export const gapLine = (g: GapExplanation) => (
  <>
    {formatRange(g.start, g.end)}, down to <Money cents={g.lowestCents} />
  </>
);

/**
 * How timing gaps change between two forecasts, from a domain comparison
 * (`gapChanges`): new and deeper gaps as warnings, smaller and resolved ones
 * as good news, or a note that nothing changes.
 */
export function GapChanges({
  newGaps,
  worsenedGaps,
  reducedGaps,
  resolvedGaps,
  proposedGaps,
}: {
  newGaps: GapExplanation[];
  worsenedGaps: GapExplanation[];
  reducedGaps: GapExplanation[];
  resolvedGaps: GapExplanation[];
  proposedGaps: GapExplanation[];
}) {
  return (
    <>
      {newGaps.map((g) => (
        <p key={`new-${g.start}`} className="callout callout-warn">
          New timing gap: {gapLine(g)}
          {g.recoversOn ? `, back to $0 or more on ${formatShort(g.recoversOn)}` : ''}.
        </p>
      ))}
      {worsenedGaps.map((g) => (
        <p key={`worse-${g.start}`} className="callout callout-warn">
          Deeper timing gap: {gapLine(g)}.
        </p>
      ))}
      {reducedGaps.map((g) => (
        <p key={`less-${g.start}`} className="callout callout-ok">
          Smaller timing gap: {gapLine(g)}.
        </p>
      ))}
      {resolvedGaps.map((g) => (
        <p key={`gone-${g.start}`} className="callout callout-ok">
          The timing gap {formatRange(g.start, g.end)} would be gone.
        </p>
      ))}
      {newGaps.length + worsenedGaps.length + reducedGaps.length + resolvedGaps.length === 0 && (
        <p className="hint">{proposedGaps.length === 0 ? 'No timing gaps either way.' : 'Your timing gaps stay as they are.'}</p>
      )}
    </>
  );
}
