declare module 'helmet' {
    import { RequestHandler } from 'express';
    interface HelmetOptions {
        contentSecurityPolicy?: boolean | object;
        [key: string]: any;
    }
    const helmet: (options?: HelmetOptions) => RequestHandler;
    export = helmet;
}

declare module 'compression' {
    import { RequestHandler } from 'express';
    interface CompressionOptions {
        [key: string]: any;
    }
    const compression: (options?: CompressionOptions) => RequestHandler;
    export = compression;
}

declare module 'swagger-ui-express' {
    import { RequestHandler } from 'express';
    export const serve: RequestHandler[];
    export function setup(swaggerDoc: any, options?: any): RequestHandler;
}
