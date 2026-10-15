import { useId } from 'react';
import * as ops from '../../domain/operations';
import { REVIEW_CADENCES, type ReviewCadence } from '../../domain/types';
import { useStore } from '../../state/store';
import { useToast } from './common';

export const CADENCE_LABEL: Record<ReviewCadence, string> = {
  off: 'Off',
  weekly: 'Weekly',
  payday: 'On payday',
  monthly: 'Monthly look-ahead',
};

const CADENCE_HINT: Record<ReviewCadence, string> = {
  off: 'No reviews. You can still look at your forecast anytime.',
  weekly: 'A short look at the week, each Sunday through Saturday.',
  payday: 'A look at each pay period, starting on your main payday.',
  monthly: 'A look at the month ahead, from the 1st.',
};

/** Settings: how often to review. Reviews appear on the dashboard when due; nothing is sent anywhere. */
export function ReviewRhythmSettings() {
  const { data, run } = useStore();
  const toast = useToast();
  const id = useId();
  const current = data.review?.cadence ?? 'off';
  const choose = (cadence: ReviewCadence) => {
    const r = run((d) => ops.setReviewCadence(d, cadence));
    if (r.ok) toast(cadence === 'off' ? 'Reviews turned off.' : `Reviews: ${CADENCE_LABEL[cadence].toLowerCase()}.`);
  };
  return (
    <section className="card settings-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Review rhythm</h2>
      <p>A quick look at what’s coming up, when it suits you. It shows on your dashboard when it’s due; there are no notifications or emails.</p>
      <fieldset className="rhythm-options">
        <legend className="sr-only">How often to review</legend>
        {REVIEW_CADENCES.map((c) => (
          <label key={c} className={`rhythm-option${current === c ? ' selected' : ''}`}>
            <input type="radio" name={`${id}-cadence`} value={c} checked={current === c} onChange={() => choose(c)} aria-describedby={`${id}-${c}`} />
            <span>
              <strong>{CADENCE_LABEL[c]}</strong>
              <span className="hint" id={`${id}-${c}`}>
                {CADENCE_HINT[c]}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
