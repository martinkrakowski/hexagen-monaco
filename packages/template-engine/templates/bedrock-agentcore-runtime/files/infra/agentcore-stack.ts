import { App, Stack, type StackProps, CfnOutput } from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/**
 * CDK stack for the AgentCore runtime's AWS prerequisites (provision = cdk).
 *
 * Provisions the ECR repository the deploy workflow pushes to and the runtime
 * execution role, mirroring iam/agentcore-runtime-role.policy.json. The agent
 * runtime itself is created/updated by the deploy pipeline against the pushed
 * image (the L1 CfnResource for bedrock-agentcore varies by CDK version, so it
 * is intentionally left to the CLI/SDK path) — keeping this stack to the stable,
 * declarative pieces.
 *
 * Deploy:  cdk bootstrap   (once per account/region)
 *          cdk deploy --app "npx tsx infra/agentcore-stack.ts"
 */
export class AgentCoreStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const region = this.region;

    const repository = new ecr.Repository(this, "AgentCoreRepository", {
      repositoryName: "{agent_name}",
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }],
    });

    const executionRole = new iam.Role(this, "AgentCoreRuntimeRole", {
      roleName: "{agent_name}-runtime-role",
      assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
      description: "Execution role for the {agent_name} AgentCore runtime",
    });

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "BedrockModelInvocation",
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:Converse",
          "bedrock:ConverseStream",
        ],
        resources: [
          `arn:aws:bedrock:${region}::foundation-model/*`,
          `arn:aws:bedrock:${region}:*:inference-profile/*`,
        ],
      }),
    );

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AgentCoreWorkloadIdentity",
        actions: [
          "bedrock-agentcore:GetWorkloadAccessToken",
          "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
          "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
        ],
        resources: ["*"],
      }),
    );

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "CloudWatchLogs",
        actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [`arn:aws:logs:${region}:*:log-group:/aws/bedrock-agentcore/*`],
      }),
    );

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "Observability",
        actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "cloudwatch:PutMetricData"],
        resources: ["*"],
      }),
    );

    new CfnOutput(this, "EcrRepositoryUri", { value: repository.repositoryUri });
    new CfnOutput(this, "ExecutionRoleArn", { value: executionRole.roleArn });
  }
}

const app = new App();
new AgentCoreStack(app, "AgentCoreStack", {
  env: { region: process.env.AWS_REGION ?? "{aws_region}" },
});
app.synth();
