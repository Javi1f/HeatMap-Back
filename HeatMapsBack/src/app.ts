import express, { Application } from 'express';
import cors from 'cors';
import kafkaRoutes from './routes/kafka.routes';
import authRoutes from './modules/auth/auth.routes';
import allowedEmailsRoutes from './modules/allowed-emails/allowed-emails.routes';
import { decryptRequest, encryptResponse } from './middlewares/crypto.middleware';

const app: Application = express();

app.use(cors());
app.use(express.json());

app.get('/ping', (req, res) => {
    res.json({ message: 'pong' });
});

// Cifrado E2E aplicado a todas las rutas API y Kafka
app.use('/api', decryptRequest, encryptResponse);
app.use('/kafka', decryptRequest, encryptResponse);

app.use('/api/allowed-emails', allowedEmailsRoutes);
app.use('/kafka', kafkaRoutes);
app.use('/api/auth', authRoutes);

export default app;
