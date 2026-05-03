import express, { Application } from 'express';
import cors from 'cors';
import kafkaRoutes from './routes/kafka.routes';
import authRoutes from './modules/auth/auth.routes';
import allowedEmailsRoutes from './modules/allowed-emails/allowed-emails.routes';

const app: Application = express();

// Middleware
app.use(cors());
app.use(express.json());

app.get('/ping', (req, res) => {
    res.json({ message: 'pong' });
});

app.use('/api/allowed-emails', allowedEmailsRoutes);
app.use('/kafka', kafkaRoutes);
app.use('/api/auth', authRoutes);

export default app;