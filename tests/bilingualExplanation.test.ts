import { buildEnglishExplanation } from '../src/utils/bilingualExplanation';

describe('English explanation backfill', () => {
  const translate = async (text: string) => `EN: ${text}`;

  it('translates a plain explanation', async () => {
    await expect(buildEnglishExplanation('شرح عربي', translate)).resolves.toBe('EN: شرح عربي');
  });

  it('preserves structured sections and writes English content separately', async () => {
    const source = JSON.stringify([{ type: 'HINT', content: 'تلميح', style: 'custom' }]);
    const result = JSON.parse((await buildEnglishExplanation(source, translate))!);
    expect(result).toEqual([{ type: 'HINT', content: 'تلميح', contentEn: 'EN: تلميح', style: 'custom' }]);
  });

  it('does not mark an unchanged provider fallback as an English translation', async () => {
    await expect(buildEnglishExplanation('شرح عربي', async (text) => text)).resolves.toBeNull();
  });
});
