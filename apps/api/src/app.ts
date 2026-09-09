import express from 'express';
import { errorHandler } from './middlewares/errorHandler';
import routes from "./routes";
import Logging from './library/logging.utils';
import cors from 'cors';
import { isAllowedFrontendOrigin } from './services/security/frontend-origin';

const app = express();

let applicationReady = false;

export const setApplicationReady = (ready: boolean): void => {
    applicationReady = ready;
};

export const isAllowedCorsOrigin = (origin: string | undefined): boolean =>
    isAllowedFrontendOrigin(origin);

export const rejectDisallowedPreflight = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
): void => {
    const origin = req.get('origin');
    if (req.method === 'OPTIONS' && !isAllowedCorsOrigin(origin)) {
        res.status(403).json({ message: 'Origin is not allowed' });
        return;
    }
    next();
};

const options: cors.CorsOptions = {
    origin: (origin, callback) => callback(null, isAllowedCorsOrigin(origin)),
    credentials: true,
    optionsSuccessStatus: 200,
};

app.use(rejectDisallowedPreflight);

app.use(cors(options));

app.use(express.json({
    limit: '10mb',
    verify: (req, _res, buffer) => {
        const request = req as express.Request;
        if (request.originalUrl.startsWith('/api/v1/webhooks/')) {
            request.rawBody = Buffer.from(buffer);
        }
    },
}));

app.use(
    express.urlencoded({ limit: '10mb', extended: true, parameterLimit: 50000 }),
);

app.use((req, _res, next) => {
    const host = req.get('host');
    const requestUrl = host
        ? `${req.protocol}://${host}${req.originalUrl}`
        : req.originalUrl;
    Logging.info(`Request: ${req.method} ${requestUrl}`);
    next();
});

app.use((_req, res, next) => {
    if (applicationReady) {
        next();
        return;
    }

    res.status(503).json({ message: 'Service is starting' });
});

app.use(express.urlencoded({ extended: true }));

app.use(express.json());

app.use('/api/v1/', routes);

// Global error handler must be registered after routes.
app.use(errorHandler);

export default app;
