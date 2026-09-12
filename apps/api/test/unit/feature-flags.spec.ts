// REQ-XCUT-03: effective-dated feature flags.
import { FeatureFlagsService } from '../../src/common/flags/feature-flags.service';

describe('feature flags', () => {
  it('resolves the row in force at the given time', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [{ enabled: true }] }) };
    const flags = new FeatureFlagsService(db as never);
    await expect(flags.isEnabled('build0.baseline')).resolves.toBe(true);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('core.feature_flags'), expect.any(Array));
  });

  it('defaults to disabled when no row is in force', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const flags = new FeatureFlagsService(db as never);
    await expect(flags.isEnabled('missing.flag')).resolves.toBe(false);
  });
});
