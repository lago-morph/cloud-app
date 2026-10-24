// Bundle-size probe only: the SDK clients and libraries the HTTP Lambda would carry at runtime.
export { RDSDataClient, ExecuteStatementCommand } from "@aws-sdk/client-rds-data";
export { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
export { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
export { drizzle } from "drizzle-orm/aws-data-api/pg";
export { handle } from "hono/aws-lambda";
