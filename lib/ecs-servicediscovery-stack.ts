import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as aws_ecs from "aws-cdk-lib/aws-ecs";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import * as iam from "aws-cdk-lib/aws-iam";
import * as efs from "aws-cdk-lib/aws-efs";
import * as route53 from "aws-cdk-lib/aws-route53";
import { CfnOutput, Duration } from "aws-cdk-lib";

export class EcsServicediscoveryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ECSクラスター用のVPC
    const vpc = new ec2.Vpc(this, "ECSVPC", {
      cidr: "10.0.0.0/16",
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "isolatedSubnet",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // ECSクラスターのService Discoveryで作成したHostedZoneを紐づけテスト用のVPC
    const testvpc = new ec2.Vpc(this, "TestVPC", {
      cidr: "10.0.0.0/16",
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "isolatedSubnet",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // ECSクラスターの作成
    const cluster = new aws_ecs.Cluster(this, "Cluster", {
      vpc: vpc,
      containerInsights: true,
      enableFargateCapacityProviders: true,
      //　デフォルトの名前空間を作成
      defaultCloudMapNamespace: {
        name: "local",
        vpc: vpc,
      },
    });


    // CloudMapリソースの作成
    const dnsnamespace = new servicediscovery.PrivateDnsNamespace(
      this,
      "ServiceDiscovery",
      {
        name: "service",
        vpc: vpc,

      }
    );

    // ECS Exec Role
    const taskRole = new iam.Role(this, "TaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
          "elasticfilesystem:*",
        ],
        resources: ["*"],
      })
    );

    // ECSのタスク定義、サービスの作成を実施
    const taskDefinition = new aws_ecs.FargateTaskDefinition(this, "nginx", {
      memoryLimitMiB: 512,
      taskRole,
    });

    const container = taskDefinition.addContainer("nginx", {
      image: aws_ecs.ContainerImage.fromRegistry("nginx:latest"),
      portMappings: [{ containerPort: 80 }],
    });

    const ecsService = new aws_ecs.FargateService(this, "FargateService", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      assignPublicIp: true,
      desiredCount: 2,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },

      // Service Discoveryの設定（デフォルトではない名前空間を利用）
      cloudMapOptions: {
        name: "nginx",
        cloudMapNamespace: dnsnamespace,
        dnsRecordType: servicediscovery.DnsRecordType.A,
        dnsTtl: Duration.seconds(30),
      },
    });

    // 作成したdnsnamespaceからHostedZoneIdを取得してaddVpcメソッドを実行
    // ただし、こちらのIssueにある通り実行ができない
    // https://github.com/aws/aws-cdk/issues/10413
    const privateHostedZone = route53.PrivateHostedZone.fromHostedZoneId(
      this, "HostZone", dnsnamespace.namespaceHostedZoneId
    ) as route53.PrivateHostedZone

    privateHostedZone.addVpc(testvpc);

  }
}
