import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import * as cwactions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as kms from "aws-cdk-lib/aws-kms";

export interface ObservabilityStackProps extends StackProps {
  phiKeyArn: string;
  alertEmail: string;
}

export class ObservabilityStack extends Stack {
  public readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const phiKey = kms.Key.fromKeyArn(this, "PhiKeyImported", props.phiKeyArn);

    this.alertTopic = new sns.Topic(this, "Alerts", {
      topicName: "bt-alerts",
      masterKey: phiKey,
    });
    this.alertTopic.addSubscription(new subs.EmailSubscription(props.alertEmail));

    // Dimensionless per-Lambda alarms — any bt-* function error spike pages.
    const lambdaErrorAlarm = (name: string, fnName: string) => {
      new cw.Alarm(this, name, {
        metric: new cw.Metric({
          namespace: "AWS/Lambda",
          metricName: "Errors",
          dimensionsMap: { FunctionName: fnName },
          statistic: "Sum",
          period: Duration.minutes(5),
        }),
        threshold: 3,
        evaluationPeriods: 1,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
        alarmDescription: `${fnName} errors spike`,
      }).addAlarmAction(new cwactions.SnsAction(this.alertTopic));
    };
    lambdaErrorAlarm("VerifyInsuranceErrors", "bt-verify-insurance");
    lambdaErrorAlarm("HandleChatErrors", "bt-handle-chat");
    lambdaErrorAlarm("GetPatientDataErrors", "bt-get-patient-data");
    lambdaErrorAlarm("GetDashboardMetricsErrors", "bt-get-dashboard-metrics");

    // API Gateway-level 5xx burst alarm (dimension on ApiName).
    new cw.Alarm(this, "Api5xx", {
      metric: new cw.Metric({
        namespace: "AWS/ApiGateway",
        metricName: "5XXError",
        dimensionsMap: { ApiName: "bt-api", Stage: "prod" },
        statistic: "Sum",
        period: Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      alarmDescription: "API Gateway 5xx spike",
    }).addAlarmAction(new cwactions.SnsAction(this.alertTopic));

    // DynamoDB throttles.
    new cw.Alarm(this, "DdbThrottles", {
      metric: new cw.Metric({
        namespace: "AWS/DynamoDB",
        metricName: "ThrottledRequests",
        dimensionsMap: { TableName: "bt-main" },
        statistic: "Sum",
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      alarmDescription: "DynamoDB throttles on bt-main",
    }).addAlarmAction(new cwactions.SnsAction(this.alertTopic));
  }
}
