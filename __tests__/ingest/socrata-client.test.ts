import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchSocrata } from '@/scripts/ingest/socrata-client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Suppress console.log/warn from retry logic during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

function okResponse(data: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(data),
  };
}

function errorResponse(status: number, body = '') {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
  };
}

describe('fetchSocrata', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    delete process.env.SOCRATA_APP_TOKEN;
    vi.useRealTimers();
  });

  afterEach(() => {
    delete process.env.SOCRATA_APP_TOKEN;
  });

  // ── URL construction ──────────────────────────────────────────────

  describe('URL construction', () => {
    it('builds basic URL from domain and datasetId', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));

      await fetchSocrata({ domain: 'data.sfgov.org', datasetId: 'wg3w-h783' });

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.origin).toBe('https://data.sfgov.org');
      expect(url.pathname).toBe('/resource/wg3w-h783.json');
    });

    it('includes $select, $where, $group, $order when provided', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));

      await fetchSocrata({
        domain: 'data.sfgov.org',
        datasetId: 'abc-123',
        select: 'neighborhood, count(*)',
        where: "date > '2025-01-01'",
        group: 'neighborhood',
        order: 'neighborhood ASC',
      });

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.get('$select')).toBe('neighborhood, count(*)');
      expect(url.searchParams.get('$where')).toBe("date > '2025-01-01'");
      expect(url.searchParams.get('$group')).toBe('neighborhood');
      expect(url.searchParams.get('$order')).toBe('neighborhood ASC');
    });

    it('sets $limit and $offset when provided', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));

      await fetchSocrata({
        domain: 'data.oaklandca.gov',
        datasetId: 'xyz-789',
        limit: 100,
        offset: 200,
      });

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.get('$limit')).toBe('100');
      expect(url.searchParams.get('$offset')).toBe('200');
    });

    it('defaults $limit to 50000 and $offset to 0', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));

      await fetchSocrata({ domain: 'data.sfgov.org', datasetId: 'abc-123' });

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.get('$limit')).toBe('50000');
      expect(url.searchParams.get('$offset')).toBe('0');
    });

    it('omits optional query params when not provided', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));

      await fetchSocrata({ domain: 'data.sfgov.org', datasetId: 'abc-123' });

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.has('$select')).toBe(false);
      expect(url.searchParams.has('$where')).toBe(false);
      expect(url.searchParams.has('$group')).toBe(false);
      expect(url.searchParams.has('$order')).toBe(false);
    });
  });

  // ── App token handling ────────────────────────────────────────────

  describe('app token handling', () => {
    it('sends X-App-Token header when appToken param is provided', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));

      await fetchSocrata({
        domain: 'data.sfgov.org',
        datasetId: 'abc-123',
        appToken: 'my-explicit-token',
      });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['X-App-Token']).toBe('my-explicit-token');
    });

    it('falls back to SOCRATA_APP_TOKEN env var', async () => {
      process.env.SOCRATA_APP_TOKEN = 'env-token-value';
      mockFetch.mockResolvedValueOnce(okResponse([]));

      await fetchSocrata({ domain: 'data.sfgov.org', datasetId: 'abc-123' });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['X-App-Token']).toBe('env-token-value');
    });

    it('prefers explicit appToken over env var', async () => {
      process.env.SOCRATA_APP_TOKEN = 'env-token';
      mockFetch.mockResolvedValueOnce(okResponse([]));

      await fetchSocrata({
        domain: 'data.sfgov.org',
        datasetId: 'abc-123',
        appToken: 'explicit-token',
      });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['X-App-Token']).toBe('explicit-token');
    });

    it('omits X-App-Token header when no token is available', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));

      await fetchSocrata({ domain: 'data.sfgov.org', datasetId: 'abc-123' });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['X-App-Token']).toBeUndefined();
    });

    it('always sends Accept: application/json header', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));

      await fetchSocrata({ domain: 'data.sfgov.org', datasetId: 'abc-123' });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Accept']).toBe('application/json');
    });
  });

  // ── Successful response ───────────────────────────────────────────

  describe('successful response', () => {
    it('returns parsed JSON array', async () => {
      const data = [
        { neighborhood: 'Mission', cnt: '42' },
        { neighborhood: 'SOMA', cnt: '31' },
      ];
      mockFetch.mockResolvedValueOnce(okResponse(data));

      const result = await fetchSocrata({
        domain: 'data.sfgov.org',
        datasetId: 'wg3w-h783',
      });

      expect(result).toEqual(data);
    });

    it('handles empty array response', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([]));

      const result = await fetchSocrata({
        domain: 'data.sfgov.org',
        datasetId: 'abc-123',
      });

      expect(result).toEqual([]);
    });

    it('does not retry on success', async () => {
      mockFetch.mockResolvedValueOnce(okResponse([{ id: 1 }]));

      await fetchSocrata({ domain: 'data.sfgov.org', datasetId: 'abc-123' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ── Error handling & retries ──────────────────────────────────────

  describe('error handling and retries', () => {
    it('retries on HTTP 429 and eventually succeeds', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(errorResponse(429, 'Too Many Requests'))
        .mockResolvedValueOnce(okResponse([{ id: 1 }]));

      const promise = fetchSocrata({ domain: 'data.sfgov.org', datasetId: 'abc-123' });

      // Advance past the 1s retry delay (BASE_DELAY_MS * 2^0)
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;
      expect(result).toEqual([{ id: 1 }]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries on HTTP 500', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(errorResponse(500, 'Internal Server Error'))
        .mockResolvedValueOnce(okResponse([{ ok: true }]));

      const promise = fetchSocrata({ domain: 'data.sfgov.org', datasetId: 'abc-123' });
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;
      expect(result).toEqual([{ ok: true }]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries on HTTP 404 (all non-ok statuses trigger retry)', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(errorResponse(404, 'Not Found'))
        .mockResolvedValueOnce(okResponse([]));

      const promise = fetchSocrata({ domain: 'data.sfgov.org', datasetId: 'abc-123' });
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;
      expect(result).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries on network error', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValueOnce(okResponse([{ recovered: true }]));

      const promise = fetchSocrata({ domain: 'data.sfgov.org', datasetId: 'abc-123' });
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;
      expect(result).toEqual([{ recovered: true }]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all 3 attempts (1 initial + 2 retries)', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(errorResponse(500, 'fail 1'))
        .mockResolvedValueOnce(errorResponse(500, 'fail 2'))
        .mockResolvedValueOnce(errorResponse(500, 'fail 3'));

      const promise = fetchSocrata({ domain: 'data.sfgov.org', datasetId: 'abc-123' });

      // Capture the rejection immediately to prevent unhandled rejection
      const caught = promise.catch((e: Error) => e);

      await vi.advanceTimersByTimeAsync(5000);

      const error = await caught;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('Socrata fetch failed after 3 attempts');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('includes last error message in the thrown error', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockRejectedValueOnce(new Error('network down'))
        .mockRejectedValueOnce(new Error('network down'))
        .mockRejectedValueOnce(new Error('still down'));

      const promise = fetchSocrata({ domain: 'data.sfgov.org', datasetId: 'abc-123' });

      // Capture the rejection immediately to prevent unhandled rejection
      const caught = promise.catch((e: Error) => e);

      await vi.advanceTimersByTimeAsync(5000);

      const error = await caught;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('still down');
    });
  });

  // ── Retry timing ──────────────────────────────────────────────────

  describe('retry timing (exponential backoff)', () => {
    it('first retry waits 1000ms, second waits 2000ms', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(errorResponse(503))
        .mockResolvedValueOnce(errorResponse(503))
        .mockResolvedValueOnce(okResponse([{ done: true }]));

      const promise = fetchSocrata({ domain: 'data.sfgov.org', datasetId: 'abc-123' });

      // After first failure, only 1 call made
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance 999ms - not enough for first retry
      await vi.advanceTimersByTimeAsync(999);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance 1 more ms to hit 1000ms - triggers retry 1
      await vi.advanceTimersByTimeAsync(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Advance 1999ms - not enough for second retry (needs 2000ms)
      await vi.advanceTimersByTimeAsync(1999);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Advance 1 more ms to hit 2000ms - triggers retry 2
      await vi.advanceTimersByTimeAsync(1);

      const result = await promise;
      expect(result).toEqual([{ done: true }]);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});
