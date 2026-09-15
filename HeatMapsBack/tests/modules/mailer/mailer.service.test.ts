import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMail, createTransport } = vi.hoisted(() => {
    const envio = vi.fn();
    return { sendMail: envio, createTransport: vi.fn(() => ({ sendMail: envio })) };
});
vi.mock('nodemailer', () => ({ default: { createTransport }, createTransport }));

import { MailerService } from '../../../src/modules/mailer/mailer.service';
import { loggerFalso } from '../../helpers/dobles';

const mailCfg = { host: 'smtp.test', port: 465, secure: true, user: 'u', pass: 'p', from: 'no-reply@test.co' };
const appCfg = { auth: { verificationCodeExpiresMinutes: 10, maxVerificationAttempts: 3 } };

beforeEach(() => {
    sendMail.mockReset();
    createTransport.mockClear();
});

describe('MailerService', () => {
    it('crea el transporte SMTP con la configuración', () => {
        expect(new MailerService(mailCfg as never, appCfg as never, loggerFalso())).toBeInstanceOf(MailerService);
        expect(createTransport).toHaveBeenCalledWith({ host: 'smtp.test', port: 465, secure: true, auth: { user: 'u', pass: 'p' } });
    });

    it('envía el código con los minutos de validez y los intentos', async () => {
        const logger = loggerFalso();
        await new MailerService(mailCfg as never, appCfg as never, logger).sendVerificationCode('ana@b.co', '54321');

        const correo = sendMail.mock.calls[0][0];
        expect(correo).toMatchObject({ from: '"HeatMaps" <no-reply@test.co>', to: 'ana@b.co', subject: 'Código de verificación' });
        expect(correo.html).toContain('54321');
        expect(correo.html).toContain('10 minutos');
        expect(correo.html).toContain('3 intentos');
        expect(logger.info).toHaveBeenCalledOnce();
    });

    it('registra y relanza un fallo del SMTP', async () => {
        const logger = loggerFalso();
        sendMail.mockRejectedValue(new Error('SMTP caído'));

        await expect(new MailerService(mailCfg as never, appCfg as never, logger).sendVerificationCode('a@b.co', '1')).rejects.toThrow('SMTP caído');
        expect(logger.error).toHaveBeenCalledOnce();
    });
});
