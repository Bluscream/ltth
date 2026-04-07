import { Request, Response, NextFunction } from 'express';
import { NetworkManager } from '../modules/NetworkManager';
import { ILogger } from '../modules/LoggerService';

export class CORSManager {
    constructor(
        private readonly networkManager: NetworkManager,
        private readonly logger: ILogger
    ) {}

    public middleware() {
        return (req: Request, res: Response, next: NextFunction) => {
            const origin = req.headers.origin;
            const port = parseInt(process.env.PORT || '3000', 10);

            // Dynamic CORS via NetworkManager
            if (this.networkManager.isOriginAllowed(origin as string, port)) {
                if (origin) {
                    res.header('Access-Control-Allow-Origin', origin);
                    res.header('Access-Control-Allow-Credentials', 'true');
                } else {
                    res.header('Access-Control-Allow-Origin', 'null');
                }
            }

            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

            // CSP Policy
            this.setCSPHeaders(req, res);

            next();
        };
    }

    private setCSPHeaders(req: Request, res: Response): void {
        const isDashboard = req.path === '/' || req.path.includes('/dashboard.html');
        const isPluginUI = req.path.includes('/goals/ui') || req.path.includes('/goals/overlay') ||
                           req.path.includes('/gift-milestone/ui') ||
                           req.path.includes('/plugins/') ||
                           req.path.includes('/openshock/') ||
                           req.path.includes('/viewer-xp/') ||
                           req.path.includes('/animazingpal/');
        const isChatangoEmbed = req.path.startsWith('/chatango/embed/');

        if (isChatangoEmbed) {
            res.header('Content-Security-Policy',
                "default-src 'self'; " +
                "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://st.chatango.com; " +
                "script-src-elem 'self' 'unsafe-inline' https://st.chatango.com; " +
                "style-src 'self' 'unsafe-inline'; " +
                "img-src 'self' data: blob: https:; " +
                "font-src 'self' data:; " +
                "connect-src 'self' ws: wss: wss://ws.eulerstream.com https://www.eulerstream.com http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://myinstants-api.vercel.app https://www.myinstants.com wss://*.chatango.com https://*.chatango.com; " +
                "media-src 'self' blob: data: https:; " +
                "frame-src 'self' https://*.chatango.com https://vdo.ninja https://*.vdo.ninja; " +
                "object-src 'none'; " +
                "base-uri 'self'; " +
                "form-action 'self'; " +
                "frame-ancestors 'self' null;"
            );
        } else if (isDashboard || isPluginUI) {
            res.header('Content-Security-Policy',
                "default-src 'self'; " +
                "script-src 'self' 'sha256-ieoeWczDHkReVBsRBqaal5AFMlBtNjMzgwKvLqi/tSU=' 'sha256-c4w6M/3j2U1Cx+Flf6JkYQY5MJP+YrJdgD4X3VC1Iho=' 'unsafe-eval' 'unsafe-hashes' " +
                "'sha256-yTT/2KVTQpd5jHFCHbEeJzUylNrUFt3XI9cEFapDHD8=' 'sha256-Bqhs/2Ph5wewVirN87MMeK3kQ72brnPHI7XTMcQu9JA=' 'sha256-gqLyQrF2cS5exPbEQFCeMLr9iGXnKTNLkXEJM35fDYs=' " +
                "'sha256-Jw5NghBkRZFrm6K45vNtyPk754rmysyQHbrzcGEEwQw=' 'sha256-SOoNvL5qrOUcMTnWe69ljOIhjtqC+26gMSCiSunJ864=' 'sha256-tyBLiSno8nu+gezcbY8m8hjujWw2qc4l0AIFkvBPxpU=' " +
                "'sha256-56d7YS02VhJKaBsXX+A0KTvkume5cBUobKSNjsB5efc=' 'sha256-T/RK2SHYk5O+vuvnyy6xzIswVp1EXbv8qFZxkEFT52k=' 'sha256-xTS/Zd4fyhjnPqbFzjTX2bLT2Pwa6HdhMyiYThQ99Hs=' " +
                "'sha256-5glbgXYCBUSMRmOhuA2aNQ4eOtGpx+JvzWrRF5yqu8w=' 'sha256-Zv9umbrL9etIXXf8h4Tn2ZxuKtNawP2FWmnDyd98SoQ=' 'sha256-CD1bRL7x9KCE4rebgiB2VJkyQhr1MatT/FO9KY9cVIw=' " +
                "'sha256-8ma2zXygpXCcq3kiJv4rS0k32SKVcMSL3R+NJdxoVjo=' 'sha256-/tlEW4dBeTXnKAtOeyarIXN7OLveaWQ4JyoQJIEpsHQ=' 'sha256-xu3YClpWdm0JUcsxMW/B0+Lk3vovecXUA4vWkTi/mgA=' " +
                "'sha256-JIPGJRCq83TqVvN3m7kkxylwHWo0b79G40zWfnZbrQw=' 'sha256-AdSuaVgmlfGgsCXjbD31dRAR3hljDmdiX0yJiFmG55A=' " +
                "'sha256-pkIZTNQY7BAA6zzvdEQOswJQVdWjCCJ1kfPGeTNsf7I=' 'sha256-NLOkSEP75l2qahhI8V8waw8g5W+9Zf51oD/q4a/qGUQ=' 'sha256-D/hVuFkLXG80cISOvW06JGm4tZkFXx4l076EvvbhR7c=' 'sha256-95XKTDnFGaz2BCZfpSens5prP2Lv+5i+tOn158I8V40=' " +
                "'sha256-K5uNRn2aLxLeK0fjnkWTYWN1J4Vdf92BTAKxjxfz/nQ=' 'sha256-3ymA831yuAiigbGNakMhiy5HDRlr4NxqwATjV/Nn01I=' " +
                "https://st.chatango.com; " +
                "script-src-elem 'self' 'unsafe-inline' https://st.chatango.com https://cdnjs.cloudflare.com https://cdn.tailwindcss.com https://www.youtube.com; " +
                "style-src 'self' 'unsafe-inline'; " +
                "img-src 'self' data: blob: https:; " +
                "font-src 'self' data:; " +
                "connect-src 'self' ws: wss: wss://ws.eulerstream.com https://www.eulerstream.com http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://myinstants-api.vercel.app https://www.myinstants.com wss://*.chatango.com https://*.chatango.com; " +
                "media-src 'self' blob: data: https:; " +
                "frame-src 'self' https://*.chatango.com https://vdo.ninja https://*.vdo.ninja https://www.youtube.com https://www.youtube-nocookie.com; " +
                "object-src 'none'; " +
                "base-uri 'self'; " +
                "form-action 'self'; " +
                "frame-ancestors 'self' null;"
            );
        } else {
            res.header('Content-Security-Policy',
                "default-src 'self'; " +
                "script-src 'self' 'sha256-ieoeWczDHkReVBsRBqaal5AFMlBtNjMzgwKvLqi/tSU=' 'sha256-c4w6M/3j2U1Cx+Flf6JkYQY5MJP+YrJdgD4X3VC1Iho=' 'unsafe-eval' 'unsafe-hashes' " +
                "'sha256-yTT/2KVTQpd5jHFCHbEeJzUylNrUFt3XI9cEFapDHD8=' 'sha256-Bqhs/2Ph5wewVirN87MMeK3kQ72brnPHI7XTMcQu9JA=' 'sha256-gqLyQrF2cS5exPbEQFCeMLr9iGXnKTNLkXEJM35fDYs=' " +
                "'sha256-Jw5NghBkRZFrm6K45vNtyPk754rmysyQHbrzcGEEwQw=' 'sha256-SOoNvL5qrOUcMTnWe69ljOIhjtqC+26gMSCiSunJ864=' 'sha256-tyBLiSno8nu+gezcbY8m8hjujWw2qc4l0AIFkvBPxpU=' " +
                "'sha256-56d7YS02VhJKaBsXX+A0KTvkume5cBUobKSNjsB5efc=' 'sha256-T/RK2SHYk5O+vuvnyy6xzIswVp1EXbv8qFZxkEFT52k=' 'sha256-xTS/Zd4fyhjnPqbFzjTX2bLT2Pwa6HdhMyiYThQ99Hs=' " +
                "'sha256-5glbgXYCBUSMRmOhuA2aNQ4eOtGpx+JvzWrRF5yqu8w=' 'sha256-Zv9umbrL9etIXXf8h4Tn2ZxuKtNawP2FWmnDyd98SoQ=' 'sha256-CD1bRL7x9KCE4rebgiB2VJkyQhr1MatT/FO9KY9cVIw=' " +
                "'sha256-8ma2zXygpXCcq3kiJv4rS0k32SKVcMSL3R+NJdxoVjo=' 'sha256-/tlEW4dBeTXnKAtOeyarIXN7OLveaWQ4JyoQJIEpsHQ=' 'sha256-xu3YClpWdm0JUcsxMW/B0+Lk3vovecXUA4vWkTi/mgA=' " +
                "'sha256-JIPGJRCq83TqVvN3m7kkxylwHWo0b79G40zWfnZbrQw=' 'sha256-AdSuaVgmlfGgsCXjbD31dRAR3hljDmdiX0yJiFmG55A=' " +
                "'sha256-pkIZTNQY7BAA6zzvdEQOswJQVdWjCCJ1kfPGeTNsf7I=' 'sha256-NLOkSEP75l2qahhI8V8waw8g5W+9Zf51oD/q4a/qGUQ=' 'sha256-D/hVuFkLXG80cISOvW06JGm4tZkFXx4l076EvvbhR7c=' 'sha256-95XKTDnFGaz2BCZfpSens5prP2Lv+5i+tOn158I8V40=' " +
                "'sha256-K5uNRn2aLxLeK0fjnkWTYWN1J4Vdf92BTAKxjxfz/nQ=' 'sha256-3ymA831yuAiigbGNakMhiy5HDRlr4NxqwATjV/Nn01I=' " +
                "https://st.chatango.com; " +
                "script-src-elem 'self' 'unsafe-inline' https://st.chatango.com https://cdnjs.cloudflare.com https://cdn.tailwindcss.com; " +
                "style-src 'self' 'unsafe-inline'; " +
                "img-src 'self' data: blob: https:; " +
                "font-src 'self' data:; " +
                "connect-src 'self' ws: wss: wss://ws.eulerstream.com https://www.eulerstream.com http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://myinstants-api.vercel.app https://www.myinstants.com wss://*.chatango.com https://*.chatango.com; " +
                "media-src 'self' blob: data: https:; " +
                "frame-src 'self' https://*.chatango.com https://vdo.ninja https://*.vdo.ninja; " +
                "object-src 'none'; " +
                "base-uri 'self'; " +
                "form-action 'self'; " +
                "frame-ancestors 'self' null;"
            );
        }
    }
}
