"""Token for X's public syndication endpoint.

The web embed computes::

    ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\\.)/g, "")

`Number.prototype.toString(36)` on a non-integer double has no Python
equivalent, so this ports V8's `DoubleToRadixCString` (src/numbers/conversions.cc),
which prints fractional digits only up to the input's precision.
"""

from __future__ import annotations

import math
import re

_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"


def _exponent(value: float) -> int:
    """V8 `Double(value).Exponent()`: value == significand(53 bits) * 2**exp."""
    if value == 0:
        return -1074
    _, exp = math.frexp(value)
    return exp - 53


def double_to_radix(value: float, radix: int) -> str:
    if not 2 <= radix <= 36:
        raise ValueError("radix out of range")
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "-Infinity" if value < 0 else "Infinity"
    negative = value < 0
    if negative:
        value = -value

    integer = math.floor(value)
    fraction = value - integer
    delta = 0.5 * (math.nextafter(value, math.inf) - value)
    delta = max(math.nextafter(0.0, 1.0), delta)

    frac_digits: list[int] = []
    if fraction >= delta:
        while True:
            fraction *= radix
            delta *= radix
            digit = int(fraction)
            frac_digits.append(digit)
            fraction -= digit
            if fraction > 0.5 or (fraction == 0.5 and (digit & 1)):
                if fraction + delta > 1:
                    # Round up, propagating the carry through written digits.
                    while True:
                        if not frac_digits:
                            integer += 1
                            break
                        last = frac_digits.pop()
                        if last + 1 < radix:
                            frac_digits.append(last + 1)
                            break
                    break
            if not fraction >= delta:
                break

    int_digits: list[str] = []
    integer = float(integer)
    while _exponent(integer / radix) > 0:
        integer /= radix
        int_digits.append("0")
    while True:
        remainder = math.fmod(integer, radix)
        int_digits.append(_DIGITS[int(remainder)])
        integer = (integer - remainder) / radix
        if not integer > 0:
            break

    out = "".join(reversed(int_digits))
    if frac_digits:
        out += "." + "".join(_DIGITS[d] for d in frac_digits)
    return ("-" + out) if negative else out


def syndication_token(tweet_id: str) -> str:
    value = (float(int(tweet_id)) / 1e15) * math.pi
    return re.sub(r"(0+|\.)", "", double_to_radix(value, 36))
