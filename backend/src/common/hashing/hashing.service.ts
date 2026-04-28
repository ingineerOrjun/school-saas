import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

const ROUNDS = 12;

/**
 * Password hashing abstraction. Consumers depend on this service, never on
 * bcrypt directly — so the underlying algorithm can be swapped without
 * touching auth code.
 */
@Injectable()
export class HashingService {
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, ROUNDS);
  }

  compare(plain: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(plain, hashed);
  }
}
