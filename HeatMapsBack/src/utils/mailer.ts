import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: parseInt(process.env.MAIL_PORT || '587', 10),
    secure: false,
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
    },
});

export async function sendVerificationEmail(email: string, code: string): Promise<void> {
    await transporter.sendMail({
        from: `"HeatMaps" <${process.env.MAIL_FROM}>`,
        to: email,
        subject: 'Código de verificación',
        html: `
            <h2>Verificación de cuenta</h2>
            <p>Tu código de verificación es:</p>
            <h1 style="letter-spacing: 8px;">${code}</h1>
            <p>Este código expira en ${process.env.VERIFICATION_CODE_EXPIRES_MINUTES || 15} minutos.</p>
            <p>Tienes 3 intentos. Si no solicitaste este registro, ignora este correo.</p>
        `
    });
}