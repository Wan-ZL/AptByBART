import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scrapeWithOpenAI } from '@/scripts/scrapers/openai-fallback';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('scrapeWithOpenAI', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.OPENAI_API_KEY = 'sk-test-key';
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('returns null when no API key is set and does NOT call fetch', async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });
    expect(result).toBeNull();
    // Must verify fetch was NOT called — kills the `if (!apiKey)` → `if (false)` mutant
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null when page fetch fails (res.ok = false) and does not call OpenAI', async () => {
    // Give the HTML mock a text() method so if the ok check is skipped,
    // the function would proceed to call OpenAI
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => '<html><body>some content</body></html>',
    });

    // If the mutant skips the `if (!res.ok) return null` check, it would
    // call OpenAI, so set up a successful OpenAI response that returns data
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify([{ name: 'Should Not Appear', bedrooms: 1, bathrooms: 1, priceMin: 9999, priceMax: null, sqftMin: null, sqftMax: null, availableUnits: null }]),
          },
        }],
      }),
    });

    const result = await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });
    expect(result).toBeNull();
    // Only the HTML fetch should have been called, not OpenAI
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when page fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });
    expect(result).toBeNull();
  });

  it('returns parsed floor plans from a successful OpenAI response', async () => {
    // First fetch: HTML page
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><body><div class="floor-plan">1BR $2,500</div></body></html>',
    });

    // Second fetch: OpenAI API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify([
              {
                name: 'Studio A',
                bedrooms: 0,
                bathrooms: 1,
                sqftMin: 450,
                sqftMax: null,
                priceMin: 2100,
                priceMax: 2300,
                availableUnits: 3,
              },
              {
                name: '1BR Plan B',
                bedrooms: 1,
                bathrooms: 1,
                sqftMin: 650,
                sqftMax: 700,
                priceMin: 2500,
                priceMax: 2800,
                availableUnits: null,
              },
            ]),
          },
        }],
      }),
    });

    const result = await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });

    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({
      name: 'Studio A',
      bedrooms: 0,
      bathrooms: 1,
      sqftMin: 450,
      sqftMax: null,
      priceMin: 2100,
      priceMax: 2300,
      availableUnits: 3,
    });
    expect(result![1].name).toBe('1BR Plan B');
    expect(result![1].bedrooms).toBe(1);
    expect(result![1].priceMin).toBe(2500);
  });

  it('handles OpenAI response wrapped in markdown fences', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><body>content</body></html>',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '```json\n[{"name":"Plan A","bedrooms":2,"bathrooms":2,"sqftMin":900,"sqftMax":null,"priceMin":3000,"priceMax":null,"availableUnits":null}]\n```',
          },
        }],
      }),
    });

    const result = await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].bedrooms).toBe(2);
    expect(result![0].priceMin).toBe(3000);
  });

  it('returns null when OpenAI returns empty array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html></html>',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '[]' } }],
      }),
    });

    const result = await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });
    expect(result).toBeNull();
  });

  it('returns null when OpenAI API returns error status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html></html>',
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    });

    const result = await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });
    expect(result).toBeNull();
  });

  it('defaults missing numeric fields correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html></html>',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify([
              {
                name: null,
                bedrooms: 'not a number',
                bathrooms: undefined,
                sqftMin: 'invalid',
                priceMin: 1500,
              },
            ]),
          },
        }],
      }),
    });

    const result = await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });
    expect(result).not.toBeNull();
    expect(result![0].bedrooms).toBe(0);     // defaults non-number to 0
    expect(result![0].bathrooms).toBe(1);    // defaults non-number to 1
    expect(result![0].sqftMin).toBeNull();   // defaults non-number to null
    expect(result![0].priceMin).toBe(1500);  // preserves valid number
  });

  it('strips HTML scripts/styles before sending to OpenAI', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><script>alert("xss")</script><style>.x{color:red}</style><body>content</body></html>',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '[]' } }],
      }),
    });

    await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });

    // Verify the second fetch (OpenAI API) received stripped HTML
    const apiCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    const htmlSent = apiCallBody.messages[1].content;
    expect(htmlSent).not.toContain('<script>');
    expect(htmlSent).not.toContain('<style>');
    expect(htmlSent).toContain('content');
  });

  it('calls OpenAI API with correct URL, method, and model', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><body>apt info</body></html>',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '[]' } }],
      }),
    });

    await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });

    // Verify HTML fetch URL
    expect(mockFetch.mock.calls[0][0]).toBe('https://example.com');

    // Verify OpenAI API call URL and method
    expect(mockFetch.mock.calls[1][0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(mockFetch.mock.calls[1][1].method).toBe('POST');

    // Verify headers
    const headers = mockFetch.mock.calls[1][1].headers;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toContain('Bearer');
    expect(headers['Authorization']).toContain('sk-test-key');

    // Verify model
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.model).toBe('gpt-5.4');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });

  it('sends HTML fetch with correct User-Agent and Accept headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html></html>',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '[]' } }],
      }),
    });

    await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://test.com' });

    // HTML fetch should include UA and Accept headers
    const htmlFetchOpts = mockFetch.mock.calls[0][1];
    expect(htmlFetchOpts.headers['User-Agent']).toContain('Mozilla');
    expect(htmlFetchOpts.headers['Accept']).toContain('text/html');
  });

  it('truncates HTML over 100k chars before sending', async () => {
    const longHtml = '<html><body>' + 'x'.repeat(150_000) + '</body></html>';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => longHtml,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '[]' } }],
      }),
    });

    await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    const htmlInPrompt = body.messages[1].content;
    // The HTML sent to OpenAI should be truncated to ~100k
    // (the prompt template adds text around it, so total will be > 100k)
    expect(htmlInPrompt.length).toBeLessThan(longHtml.length);
  });

  it('returns null when OpenAI response has no JSON array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html></html>',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'No floor plans found on this page.' } }],
      }),
    });

    const result = await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });
    expect(result).toBeNull();
  });

  it('skips null and non-object items in parsed array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html></html>',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify([
              null,
              42,
              'string',
              { name: 'Valid', bedrooms: 1, bathrooms: 1, priceMin: 2000, priceMax: null, sqftMin: null, sqftMax: null, availableUnits: null },
            ]),
          },
        }],
      }),
    });

    const result = await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].name).toBe('Valid');
  });

  it('returns null when all parsed items are non-objects', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html></html>',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify([null, 42, 'hello']),
          },
        }],
      }),
    });

    const result = await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });
    // After filtering, no valid plans remain
    expect(result).toBeNull();
  });

  it('handles API error status and returns null (not data from error response)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html></html>',
    });

    // OpenAI API returns error but also has a json() method that would
    // return valid-looking data if the error check is skipped
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify([{ name: 'Error Plan', bedrooms: 1, bathrooms: 1, priceMin: 1000, priceMax: null, sqftMin: null, sqftMax: null, availableUnits: null }]),
          },
        }],
      }),
    });

    const result = await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });
    expect(result).toBeNull();
  });

  it('strips meta, link, noscript, and comment tags from HTML', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><meta charset="utf-8"><link rel="stylesheet" href="x.css"><!-- comment --><noscript>fallback</noscript><body>real content</body></html>',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '[]' } }],
      }),
    });

    await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    const htmlSent = body.messages[1].content;
    expect(htmlSent).not.toContain('<meta');
    expect(htmlSent).not.toContain('<link');
    expect(htmlSent).not.toContain('<!-- comment -->');
    expect(htmlSent).not.toContain('<noscript');
    expect(htmlSent).not.toContain('fallback');
    expect(htmlSent).toContain('real content');
  });

  it('collapses multiple whitespace into single spaces', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><body>word1     word2\n\n\nword3</body></html>',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '[]' } }],
      }),
    });

    await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    const htmlSent = body.messages[1].content;
    // Multiple spaces should be collapsed to single space
    expect(htmlSent).not.toContain('     ');
    expect(htmlSent).toContain('word1 word2');
  });

  it('validates sqftMax type correctly (non-number becomes null)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html></html>',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify([
              {
                name: 'Test',
                bedrooms: 1,
                bathrooms: 1,
                sqftMin: 500,
                sqftMax: 'large',
                priceMin: 2000,
                priceMax: 2500,
                availableUnits: 'many',
              },
            ]),
          },
        }],
      }),
    });

    const result = await scrapeWithOpenAI({ id: 1, websiteUrl: 'https://example.com' });
    expect(result).not.toBeNull();
    expect(result![0].sqftMax).toBeNull();    // 'large' is not a number
    expect(result![0].sqftMin).toBe(500);     // valid number preserved
    expect(result![0].priceMin).toBe(2000);   // valid number preserved
    expect(result![0].priceMax).toBe(2500);   // valid number preserved
    expect(result![0].availableUnits).toBeNull(); // 'many' is not a number
  });
});
