/**
 * 精确有理数：分子/分母均为 BigInt，分母恒正，构造时约分。
 * 不可变。所有运算不引入任何浮点，故概率/期望全程精确。
 */

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    [a, b] = [b, a % b];
  }
  return a === 0n ? 1n : a;
}

export class Rational {
  static readonly ZERO = new Rational(0n, 1n, true);
  static readonly ONE = new Rational(1n, 1n, true);

  readonly num: bigint;
  readonly den: bigint;

  private constructor(num: bigint, den: bigint, _skip?: boolean) {
    this.num = num;
    this.den = den;
  }

  static of(n: bigint | number, d: bigint | number = 1n): Rational {
    const num = BigInt(n);
    const den = BigInt(d);
    if (den === 0n) throw new Error('有理数分母不能为零');
    if (num === 0n) return Rational.ZERO;
    const g = gcd(num, den);
    return new Rational(num / g, (den < 0n ? -den : den) / g, true);
  }

  add(o: Rational): Rational {
    return Rational.of(this.num * o.den + o.num * this.den, this.den * o.den);
  }
  sub(o: Rational): Rational {
    return Rational.of(this.num * o.den - o.num * this.den, this.den * o.den);
  }
  mul(o: Rational): Rational {
    if (this === Rational.ZERO || o === Rational.ZERO) return Rational.ZERO;
    return Rational.of(this.num * o.num, this.den * o.den);
  }
  div(o: Rational): Rational {
    if (o.num === 0n) throw new Error('不能除以零');
    return Rational.of(this.num * o.den, this.den * o.num);
  }
  neg(): Rational {
    return this === Rational.ZERO ? Rational.ZERO : new Rational(-this.num, this.den, true);
  }
  cmp(o: Rational): -1 | 0 | 1 {
    const l = this.num * o.den;
    const r = o.num * this.den;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  equals(o: Rational): boolean {
    return this.num === o.num && this.den === o.den;
  }
  max(o: Rational): Rational {
    return this.cmp(o) >= 0 ? this : o;
  }

  /** "num/den"，整数时省略分母。 */
  toFraction(): string {
    return this.den === 1n ? `${this.num}` : `${this.num}/${this.den}`;
  }

  /** 十进制近似，保留 digits 位小数（四舍五入，仅用于展示）。 */
  toDecimal(digits = 10): string {
    const scale = 10n ** BigInt(digits + 1);
    const scaled = (this.num < 0n ? -this.num : this.num) * scale / this.den;
    const rounded = (scaled + 5n) / 10n;
    const neg = this.num < 0n && rounded !== 0n;
    const s = rounded.toString().padStart(digits + 1, '0');
    const intPart = s.slice(0, s.length - digits);
    const fracPart = s.slice(s.length - digits).replace(/0+$/, '');
    return `${neg ? '-' : ''}${intPart}${fracPart ? '.' + fracPart : ''}`;
  }

  toJSON(): { fraction: string; decimal: string } {
    return { fraction: this.toFraction(), decimal: this.toDecimal() };
  }
}
