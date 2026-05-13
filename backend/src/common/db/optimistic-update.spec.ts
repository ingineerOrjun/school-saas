import { ConflictException } from '@nestjs/common';
import {
  assertNotStaleAndUpdate,
  extractUpdatedAt,
  isStaleWriteConflict,
} from './optimistic-update';

// ============================================================================
// optimistic-update — unit tests. Phase FINAL-HARDENING Part 2c.
//
// Validates the contract:
//   • `updateMany` is called with the expected where clause
//     including `updatedAt`
//   • Zero rows updated → ConflictException with the contracted
//     copy
//   • One row updated → returns the row from the follow-up
//     findUnique
//   • `expectedUpdatedAt: undefined` → skips the optimistic check
//     (legacy/force update path)
//   • String + Date forms of `expectedUpdatedAt` both work
//   • `extractUpdatedAt` tolerates absent / null / unexpected types
//   • `isStaleWriteConflict` correctly narrows the thrown error
// ============================================================================

interface MockDelegate {
  updateMany: jest.Mock;
  findUnique: jest.Mock;
}

function makeDelegate(): MockDelegate {
  return {
    updateMany: jest.fn(),
    findUnique: jest.fn(),
  };
}

describe('assertNotStaleAndUpdate', () => {
  it('passes expectedUpdatedAt into the where clause and returns the fresh row', async () => {
    const delegate = makeDelegate();
    delegate.updateMany.mockResolvedValueOnce({ count: 1 });
    delegate.findUnique.mockResolvedValueOnce({
      id: 'row-1',
      firstName: 'Ada',
      updatedAt: new Date('2026-05-13T10:00:00Z'),
    });

    const expected = new Date('2026-05-13T09:00:00Z');
    const result = await assertNotStaleAndUpdate(delegate, {
      entity: 'Student',
      id: 'row-1',
      expectedUpdatedAt: expected,
      data: { firstName: 'Ada' },
    });

    expect(delegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'row-1', updatedAt: expected },
      data: { firstName: 'Ada' },
    });
    expect(delegate.findUnique).toHaveBeenCalledWith({
      where: { id: 'row-1' },
    });
    expect(result).toEqual(
      expect.objectContaining({ id: 'row-1', firstName: 'Ada' }),
    );
  });

  it('accepts a string updatedAt and converts to Date before passing through', async () => {
    const delegate = makeDelegate();
    delegate.updateMany.mockResolvedValueOnce({ count: 1 });
    delegate.findUnique.mockResolvedValueOnce({ id: 'row-2' });

    await assertNotStaleAndUpdate(delegate, {
      entity: 'Exam',
      id: 'row-2',
      expectedUpdatedAt: '2026-05-13T09:00:00.000Z',
      data: { name: 'Final' },
    });

    const passed = delegate.updateMany.mock.calls[0][0];
    expect(passed.where.id).toBe('row-2');
    expect(passed.where.updatedAt).toBeInstanceOf(Date);
    expect((passed.where.updatedAt as Date).toISOString()).toBe(
      '2026-05-13T09:00:00.000Z',
    );
  });

  it('omits updatedAt from the where clause when expectedUpdatedAt is undefined', async () => {
    const delegate = makeDelegate();
    delegate.updateMany.mockResolvedValueOnce({ count: 1 });
    delegate.findUnique.mockResolvedValueOnce({ id: 'row-3' });

    await assertNotStaleAndUpdate(delegate, {
      entity: 'Class',
      id: 'row-3',
      expectedUpdatedAt: undefined,
      data: { name: 'Grade 5' },
    });

    const passed = delegate.updateMany.mock.calls[0][0];
    expect(passed.where).toEqual({ id: 'row-3' });
    expect(passed.where.updatedAt).toBeUndefined();
  });

  it('omits updatedAt from the where clause when expectedUpdatedAt is null', async () => {
    const delegate = makeDelegate();
    delegate.updateMany.mockResolvedValueOnce({ count: 1 });
    delegate.findUnique.mockResolvedValueOnce({ id: 'row-4' });

    await assertNotStaleAndUpdate(delegate, {
      entity: 'Section',
      id: 'row-4',
      expectedUpdatedAt: null,
      data: { name: 'A' },
    });

    const passed = delegate.updateMany.mock.calls[0][0];
    expect(passed.where.updatedAt).toBeUndefined();
  });

  it('throws 409 ConflictException with the contracted copy when count === 0', async () => {
    const delegate = makeDelegate();
    // Use `mockResolvedValue` (not Once) so two assertions on the
    // same scenario can both consume a stale-write response without
    // running into an exhausted Once mock.
    delegate.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      assertNotStaleAndUpdate(delegate, {
        entity: 'Student',
        id: 'row-5',
        expectedUpdatedAt: new Date('2026-05-13T09:00:00Z'),
        data: { firstName: 'Stale' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      assertNotStaleAndUpdate(delegate, {
        entity: 'Student',
        id: 'row-5',
        expectedUpdatedAt: new Date('2026-05-13T09:00:00Z'),
        data: { firstName: 'Stale' },
      }),
    ).rejects.toThrow(/updated by another user/i);

    // Should NOT have called findUnique on stale write.
    expect(delegate.findUnique).not.toHaveBeenCalled();
  });

  it('lowercases the entity name in the conflict message', async () => {
    const delegate = makeDelegate();
    delegate.updateMany.mockResolvedValueOnce({ count: 0 });

    try {
      await assertNotStaleAndUpdate(delegate, {
        entity: 'AcademicSession',
        id: 'row-6',
        expectedUpdatedAt: new Date(),
        data: {},
      });
      fail('expected ConflictException to be thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      // Message body lowercases the entity per the contract.
      expect((e as ConflictException).message).toContain('academicsession');
    }
  });
});

describe('extractUpdatedAt', () => {
  it('returns a Date when present as Date', () => {
    const d = new Date('2026-05-13T10:00:00Z');
    expect(extractUpdatedAt({ updatedAt: d })).toBe(d);
  });

  it('returns a string when present as string', () => {
    expect(extractUpdatedAt({ updatedAt: '2026-05-13T10:00:00Z' })).toBe(
      '2026-05-13T10:00:00Z',
    );
  });

  it('returns undefined when missing', () => {
    expect(extractUpdatedAt({})).toBeUndefined();
  });

  it('returns undefined when null', () => {
    expect(extractUpdatedAt({ updatedAt: null })).toBeUndefined();
  });

  it('returns undefined when wrong type', () => {
    expect(extractUpdatedAt({ updatedAt: 12345 })).toBeUndefined();
    expect(extractUpdatedAt(null)).toBeUndefined();
    expect(extractUpdatedAt(undefined)).toBeUndefined();
    expect(extractUpdatedAt('string')).toBeUndefined();
  });
});

describe('isStaleWriteConflict', () => {
  it('returns true for the exact 409 the helper throws', () => {
    const err = new ConflictException(
      'This student was updated by another user. Refresh and try again.',
    );
    expect(isStaleWriteConflict(err)).toBe(true);
  });

  it('returns false for other ConflictException messages', () => {
    expect(
      isStaleWriteConflict(
        new ConflictException('That symbol number is already assigned.'),
      ),
    ).toBe(false);
  });

  it('returns false for non-ConflictException errors', () => {
    expect(isStaleWriteConflict(new Error('boom'))).toBe(false);
    expect(isStaleWriteConflict(null)).toBe(false);
    expect(isStaleWriteConflict('string')).toBe(false);
  });
});
