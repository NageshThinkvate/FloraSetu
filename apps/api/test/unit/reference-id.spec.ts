// REQ-XCUT-04: public human-readable reference ids.
import { ReferenceIdService } from '../../src/common/pagination/reference-id.service';

describe('reference ids', () => {
  it('formats ENTITY-YEAR-000001 from the counter', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ next: '7' }] }) };
    const svc = new ReferenceIdService();
    const ref = await svc.next(client as never, 'LOT', new Date(Date.UTC(2026, 0, 1)));
    expect(ref).toBe('LOT-2026-000007');
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('core.reference_counters'), ['LOT', 2026]);
  });
});
