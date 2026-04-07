/**
 * Input Validation Utilities
 * Provides standardized validation functions for API inputs
 */

export class ValidationError extends Error {
    public field: string | null;
    public statusCode: number;

    constructor(message: string, field: string | null = null) {
        super(message);
        this.name = 'ValidationError';
        this.field = field;
        this.statusCode = 400;
    }
}

export interface StringOptions {
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp | null;
    required?: boolean;
    fieldName?: string;
}

export interface NumberOptions {
    min?: number;
    max?: number;
    integer?: boolean;
    required?: boolean;
    fieldName?: string;
}

export interface BooleanOptions {
    required?: boolean;
    fieldName?: string;
}

export interface ArrayOptions {
    minLength?: number;
    maxLength?: number;
    itemValidator?: ((item: any) => any) | null;
    required?: boolean;
    fieldName?: string;
}

export interface ObjectOptions {
    requiredFields?: string[];
    fieldValidators?: Record<string, (value: any) => any>;
    required?: boolean;
    fieldName?: string;
}

export class Validators {
    /**
     * Validate string with optional constraints
     */
    static string(value: any, options: StringOptions = {}): string {
        const {
            minLength = 0,
            maxLength = 10000,
            pattern = null,
            required = false,
            fieldName = 'value'
        } = options;

        if (required && (value === undefined || value === null || value === '')) {
            throw new ValidationError(`${fieldName} is required`, fieldName);
        }

        if (!required && (value === undefined || value === null || value === '')) {
            return value;
        }

        if (typeof value !== 'string') {
            throw new ValidationError(`${fieldName} must be a string`, fieldName);
        }

        if (value.length < minLength) {
            throw new ValidationError(`${fieldName} must be at least ${minLength} characters`, fieldName);
        }

        if (value.length > maxLength) {
            throw new ValidationError(`${fieldName} must be at most ${maxLength} characters`, fieldName);
        }

        if (pattern && !pattern.test(value)) {
            throw new ValidationError(`${fieldName} has invalid format`, fieldName);
        }

        return value;
    }

    /**
     * Validate number with optional constraints
     */
    static number(value: any, options: NumberOptions = {}): number {
        const {
            min = -Infinity,
            max = Infinity,
            integer = false,
            required = false,
            fieldName = 'value'
        } = options;

        if (required && (value === undefined || value === null)) {
            throw new ValidationError(`${fieldName} is required`, fieldName);
        }

        if (!required && (value === undefined || value === null)) {
            return value;
        }

        const num = Number(value);
        if (isNaN(num)) {
            throw new ValidationError(`${fieldName} must be a number`, fieldName);
        }

        if (integer && !Number.isInteger(num)) {
            throw new ValidationError(`${fieldName} must be an integer`, fieldName);
        }

        if (num < min) {
            throw new ValidationError(`${fieldName} must be at least ${min}`, fieldName);
        }

        if (num > max) {
            throw new ValidationError(`${fieldName} must be at most ${max}`, fieldName);
        }

        return num;
    }

    /**
     * Validate boolean
     */
    static boolean(value: any, options: BooleanOptions = {}): boolean {
        const { required = false, fieldName = 'value' } = options;

        if (required && (value === undefined || value === null)) {
            throw new ValidationError(`${fieldName} is required`, fieldName);
        }

        if (!required && (value === undefined || value === null)) {
            return value;
        }

        if (typeof value === 'boolean') {
            return value;
        }

        if (value === 'true' || value === '1' || value === 1) {
            return true;
        }

        if (value === 'false' || value === '0' || value === 0) {
            return false;
        }

        throw new ValidationError(`${fieldName} must be a boolean`, fieldName);
    }

    /**
     * Validate object with required fields
     */
    static object(value: any, options: ObjectOptions = {}): any {
        const {
            requiredFields = [],
            fieldValidators = {},
            required = false,
            fieldName = 'value'
        } = options;

        if (required && (value === undefined || value === null)) {
            throw new ValidationError(`${fieldName} is required`, fieldName);
        }

        if (!required && (value === undefined || value === null)) {
            return value;
        }

        if (typeof value !== 'object' || Array.isArray(value)) {
            throw new ValidationError(`${fieldName} must be an object`, fieldName);
        }

        for (const field of requiredFields) {
            if (!(field in value) || value[field] === undefined || value[field] === null) {
                throw new ValidationError(`${fieldName}.${field} is required`, `${fieldName}.${field}`);
            }
        }

        for (const [field, validator] of Object.entries(fieldValidators)) {
            if (field in value && value[field] !== undefined && value[field] !== null) {
                try {
                    value[field] = validator(value[field]);
                } catch (err: any) {
                    throw new ValidationError(`${fieldName}.${field}: ${err.message}`, `${fieldName}.${field}`);
                }
            }
        }

        return value;
    }
}
