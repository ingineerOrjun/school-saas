import { BadRequestException } from '@nestjs/common';
import { PlatformService } from './platform.service';

// ---------------------------------------------------------------------------
// PlatformService — tenant-status login gate.
//
// `assertSchoolCanLogin` is a static guard called from AuthService.login
// after the password check passes but before issuing a JWT. The whole
// "school suspended → blocks all logins" feature hangs off this single
// function, so its behaviour gets a focused contract test.
//
// The error MESSAGES are part of the contract too — the frontend
// surfaces them verbatim in the login form, so a copy change here
// must be deliberate.
// ---------------------------------------------------------------------------

describe('PlatformService.assertSchoolCanLogin', () => {
  it('allows ACTIVE schools', () => {
    expect(() => PlatformService.assertSchoolCanLogin('ACTIVE')).not.toThrow();
  });

  it('allows TRIAL schools (same access as ACTIVE)', () => {
    expect(() => PlatformService.assertSchoolCanLogin('TRIAL')).not.toThrow();
  });

  it('REJECTS SUSPENDED schools with a clear support-pointing message', () => {
    expect(() =>
      PlatformService.assertSchoolCanLogin('SUSPENDED'),
    ).toThrow(BadRequestException);

    try {
      PlatformService.assertSchoolCanLogin('SUSPENDED');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const msg = (e as BadRequestException).message;
      // Must mention suspension explicitly so the operator knows what
      // happened.
      expect(msg.toLowerCase()).toContain('suspended');
      expect(msg.toLowerCase()).toContain('contact support');
    }
  });

  it('REJECTS EXPIRED schools with a renewal-pointing message', () => {
    expect(() =>
      PlatformService.assertSchoolCanLogin('EXPIRED'),
    ).toThrow(BadRequestException);

    try {
      PlatformService.assertSchoolCanLogin('EXPIRED');
    } catch (e) {
      const msg = (e as BadRequestException).message;
      expect(msg.toLowerCase()).toContain('expired');
      expect(msg.toLowerCase()).toContain('renew');
    }
  });
});
