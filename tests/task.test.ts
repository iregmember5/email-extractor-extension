import { describe, expect, it } from 'vitest';
import { emptyTask, taskPayload, validateTask, safeUrl } from '../src/task';
describe('Task contract', () => {
  it('requires an explicit folder or category instead of treating Any as a value', () => {
    const task = emptyTask();
    task.task_name = 'Invoices';
    expect(task.labels).toEqual([]);
    expect(validateTask(task).labels).toBeTruthy();
    task.categories = ['CATEGORY_UPDATES'];
    expect(validateTask(task).labels).toBeUndefined();
  });
  it('normalizes optional dates, inactive settings, and output order without leaking response fields', () => {
    const task = {
      ...emptyTask(),
      id: 55,
      is_deleted: false,
      task_name: '  Invoices  ',
      from_field: false,
      open_email_link_field: true,
      mark_as_processed_action: 'label',
      mark_as_processed_label: 'Old',
    };
    const payload = taskPayload(task);
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('is_deleted');
    expect(payload.task_name).toBe('Invoices');
    expect(payload.after_date).toBeNull();
    expect(payload.sequence).not.toContain('From');
    expect(payload.sequence).toContain('Open in Gmail');
    expect(payload.mark_as_processed_action).toBe('');
    expect(payload.mark_as_processed_label).toBe('');
    expect(payload.schedule_time).toBe('');
  });
  it('checks date range, schedule timezone, and parsing rule column names', () => {
    const task = {
      ...emptyTask(),
      task_name: 'Test',
      labels: ['INBOX'],
      after_date: '2026-10-01',
      before_date: '2026-09-01',
      schedule_enabled: true,
      schedule_timezone: 'made/up',
      parsing_rules: [
        { column_name: 'Amount', regex_pattern: '(1)', source: 'body' as const },
        { column_name: 'amount', regex_pattern: '(2)', source: 'body' as const },
      ],
    };
    expect(validateTask(task)).toMatchObject({
      before_date: expect.any(String),
      schedule_timezone: expect.any(String),
      rule_1: expect.any(String),
    });
  });
  it('blocks unsafe links and OAuth hosts', () => {
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(
      safeUrl('https://accounts.google.com.evil.org', ['accounts.google.com']),
    ).toBeUndefined();
    expect(
      safeUrl('https://accounts.google.com/o/oauth2/auth', ['accounts.google.com']),
    ).toBeTruthy();
  });
});
