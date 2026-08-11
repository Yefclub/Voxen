declare module 'java-random' {
  export default class JavaRandom {
    constructor(seed?: number);
    setSeed(seed: number): void;
    nextInt(bound?: number): number;
    nextBoolean(): boolean;
    nextFloat(): number;
    nextDouble(): number;
    nextGaussian(): number;
  }
}
