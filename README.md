           BCH JSON Web Token via AWS Secrets Manager
           
Deployment process:

* Configure aws cli tools with IAM credentials.
* Add necessary IAM policy/permissions to set up `Cloudformation Stack` and `S3` via cli
* Clone the most current version from [Releases](https://github.com/sweet-io-org/bchjs-jwt-aws-secret/releases)
* Run `npm install`
* Execute packaging: 
```
aws cloudformation package \
  --template-file template.yaml \
  --s3-bucket <<YOUR_DEPLOYMENT_BUCKET>> \
  --output-template-file template.packaged.yml
```
Substitute `<<YOUR_DEPLOYMENT_BUCKET>>` with a bucket name to upload packaged Cloudformation template.

* Execute deploy of the previously created package:
```
aws cloudformation deploy --template-file template.packaged.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides userName=<<username>> userPassword=<<password>> \
  --stack-name bchjs-jwt-aws-secret
```
Substitute `<<username>>` and `<<password>>` with your credentials from [FullStack](https://fullstack.cash/profile) Update the stack name if necessary.


---

#### Optional
Override `fullStackAuthUrl` and `fullStackApiUrl` to match your setup with FullStack API.
Default values are:
- `fullStackAuthUrl`: https://auth.fullstack.cash
- `fullStackApiUrl`:  https://api.fullstack.cash`

Specify `secretManagerEndpoint` according to your [region](https://docs.aws.amazon.com/general/latest/gr/asm.html)
Default values for `us-east-1`:
- `https://secretsmanager.us-east-1.amazonaws.com`

Please note that default AWS Secret Manager endpoint uses a public network. To setup secure connection follow the instruction to create a Secrets Manager VPC endpoint [here](https://docs.aws.amazon.com/secretsmanager/latest/userguide/vpc-endpoint-overview.html).

