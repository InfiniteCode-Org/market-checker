# AWS Prerequisites for Price Monitoring Service Deployment

Before running the `aws-deploy.sh` script, complete these prerequisite steps:

## 1. Set Up AWS CLI

Ensure AWS CLI is installed and configured with appropriate credentials:

```bash
aws configure
```

## 2. Create RDS PostgreSQL Database

```bash
# Create a security group for the database
aws ec2 create-security-group \
  --group-name price-monitoring-db-sg \
  --description "Security group for Price Monitoring DB" \
  --vpc-id vpc-xxxxxxxx

# Allow PostgreSQL traffic from your ECS security group
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxxxxx \  # Replace with the SG ID created above
  --protocol tcp \
  --port 5432 \
  --source-group sg-yyyyyyyy  # Replace with your ECS security group ID

# Create the DB subnet group
aws rds create-db-subnet-group \
  --db-subnet-group-name price-monitoring-subnet-group \
  --db-subnet-group-description "Subnet group for Price Monitoring DB" \
  --subnet-ids subnet-xxxxxxxx subnet-yyyyyyyy  # Replace with your subnet IDs

# Create the RDS instance
aws rds create-db-instance \
  --db-instance-identifier price-monitoring-db \
  --db-instance-class db.t3.small \
  --engine postgres \
  --engine-version 14 \
  --allocated-storage 20 \
  --master-username admin \
  --master-user-password YourStrongPassword \
  --db-subnet-group-name price-monitoring-subnet-group \
  --vpc-security-group-ids sg-xxxxxxxx \  # Replace with DB security group ID
  --db-name crypto_monitoring \
  --no-publicly-accessible
```

## 3. Create Required IAM Roles

### Lambda Role

```bash
# Create the Lambda execution role
aws iam create-role \
  --role-name lambda-sqs-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Service": "lambda.amazonaws.com"
        },
        "Action": "sts:AssumeRole"
      }
    ]
  }'

# Attach necessary policies
aws iam attach-role-policy \
  --role-name lambda-sqs-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam attach-role-policy \
  --role-name lambda-sqs-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSQSFullAccess

# Create custom policy for RDS access
aws iam create-policy \
  --policy-name lambda-rds-access \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "rds-db:connect"
        ],
        "Resource": "*"
      }
    ]
  }'

# Attach the custom policy
aws iam attach-role-policy \
  --role-name lambda-sqs-role \
  --policy-arn arn:aws:iam::$(aws sts get-caller-identity --query 'Account' --output text):policy/lambda-rds-access
```

### ECS Task Execution Role

```bash
# Create the ECS task execution role
aws iam create-role \
  --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Service": "ecs-tasks.amazonaws.com"
        },
        "Action": "sts:AssumeRole"
      }
    ]
  }'

# Attach necessary policies
aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

### ECS Task Role

```bash
# Create the ECS task role
aws iam create-role \
  --role-name ecsTaskRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Service": "ecs-tasks.amazonaws.com"
        },
        "Action": "sts:AssumeRole"
      }
    ]
  }'

# Attach necessary policies
aws iam attach-role-policy \
  --role-name ecsTaskRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonSQSFullAccess

# Create custom policy for RDS access
aws iam create-policy \
  --policy-name ecs-rds-access \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "rds-db:connect"
        ],
        "Resource": "*"
      }
    ]
  }'

# Attach the custom policy
aws iam attach-role-policy \
  --role-name ecsTaskRole \
  --policy-arn arn:aws:iam::$(aws sts get-caller-identity --query 'Account' --output text):policy/ecs-rds-access
```

## 4. Set Up Networking

Create a security group for ECS and configure it to allow necessary traffic:

```bash
# Create security group for ECS tasks
aws ec2 create-security-group \
  --group-name price-monitoring-ecs-sg \
  --description "Security group for Price Monitoring ECS tasks" \
  --vpc-id vpc-xxxxxxxx

# Allow inbound traffic for the application's port
aws ec2 authorize-security-group-ingress \
  --group-id sg-yyyyyyyy \  # Replace with the ECS SG ID created above
  --protocol tcp \
  --port 8080 \
  --cidr 0.0.0.0/0

# Allow outbound traffic
aws ec2 authorize-security-group-egress \
  --group-id sg-yyyyyyyy \  # Replace with the ECS SG ID created above
  --protocol -1 \
  --port -1 \
  --cidr 0.0.0.0/0
```

## 5. Create CloudWatch Log Group

```bash
aws logs create-log-group \
  --log-group-name /ecs/price-monitoring \
  --region us-east-1
```

## 6. Update Configuration Values

Once all resources are created, update the following placeholders in `aws-deploy.sh`:

1. Replace `subnet-xxxxxxxx` with your actual subnet ID.
2. Replace `sg-xxxxxxxx` with your actual ECS security group ID.
3. Update the DATABASE_URL in the script with the correct credentials and endpoint for your RDS instance.

## 7. Run the Deployment Script

After completing all prerequisites, make the deployment script executable and run it:

```bash
chmod +x aws-deploy.sh
./aws-deploy.sh
``` 