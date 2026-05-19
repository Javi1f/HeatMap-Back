import { beforeAll, describe, expect, it } from 'vitest';
import { container } from 'tsyringe';
import { SensorPayloadCipher } from '../../src/crypto/sensor-payload.crypto';
import { SensorPayload } from '../../src/types/sensor.types';

describe('SensorPayloadCipher', () => {
    let cipher: SensorPayloadCipher;

    beforeAll(() => {
        cipher = container.resolve(SensorPayloadCipher);
    });

    const sample: SensorPayload = {
        sensor_id: 'sensor-1',
        total_devices: 2,
        timestamp: 1_710_000_000,
        devices: [
            {
                mac: 'aa:bb:cc:dd:ee:ff',
                rssi: -50,
                channel: 6,
                type: 'probe',
                packets: 3,
                last_seen: '12:00:00',
                randomized: false,
            },
        ],
    };

    it('encrypt → decrypt es un round-trip', () => {
        const raw = cipher.encrypt(sample);
        expect(Buffer.isBuffer(raw)).toBe(true);
        expect(cipher.decrypt(raw)).toEqual(sample);
    });

    it('decrypt rechaza buffers demasiado cortos', () => {
        expect(() => cipher.decrypt(Buffer.alloc(4))).toThrow();
    });

    it('encrypt usa nonces distintos en cada llamada', () => {
        const a = cipher.encrypt(sample);
        const b = cipher.encrypt(sample);
        expect(Buffer.compare(a, b)).not.toBe(0);
    });
});
