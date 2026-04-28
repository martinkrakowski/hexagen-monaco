/**
 * Few-shot examples for manifest generation
 *
 * These examples help the LLM understand the expected output format
 * and improve generation quality through demonstration.
 */

export interface FewShotExample {
  description: string;
  manifest: string;
}

export const FEW_SHOT_EXAMPLES: FewShotExample[] = [
  {
    description:
      "I'm building an e-commerce platform with user authentication, product catalog, shopping cart, and payment processing.",
    manifest: `workspace:
  name: ecommerce-platform
  description: E-commerce platform with authentication and payments

boundedContexts:
  - name: user-management
    description: User authentication and profile management
    ports:
      in:
        - name: RegisterUserPort
          type: UseCase
          description: Register new user account
        - name: AuthenticateUserPort
          type: UseCase
          description: Authenticate user credentials
        - name: UpdateProfilePort
          type: UseCase
          description: Update user profile information
      out:
        - name: UserRepositoryPort
          type: Repository
          description: Persist user data
        - name: EmailServicePort
          type: Service
          description: Send email notifications
    adapters:
      - name: PostgresUserAdapter
        type: Repository
        implements: UserRepositoryPort
      - name: SendGridEmailAdapter
        type: Service
        implements: EmailServicePort

  - name: product-catalog
    description: Product inventory and catalog management
    ports:
      in:
        - name: CreateProductPort
          type: UseCase
          description: Add new product to catalog
        - name: SearchProductsPort
          type: UseCase
          description: Search products by criteria
        - name: UpdateInventoryPort
          type: UseCase
          description: Update product inventory levels
      out:
        - name: ProductRepositoryPort
          type: Repository
          description: Persist product data
        - name: SearchEnginePort
          type: Service
          description: Full-text product search
    adapters:
      - name: PostgresProductAdapter
        type: Repository
        implements: ProductRepositoryPort
      - name: ElasticsearchAdapter
        type: Service
        implements: SearchEnginePort

  - name: shopping-cart
    description: Shopping cart and order management
    ports:
      in:
        - name: AddToCartPort
          type: UseCase
          description: Add item to shopping cart
        - name: CheckoutPort
          type: UseCase
          description: Process cart checkout
        - name: ViewOrderHistoryPort
          type: UseCase
          description: View past orders
      out:
        - name: CartRepositoryPort
          type: Repository
          description: Persist cart data
        - name: OrderRepositoryPort
          type: Repository
          description: Persist order data
        - name: PaymentGatewayPort
          type: Gateway
          description: Process payments
    adapters:
      - name: RedisCartAdapter
        type: Repository
        implements: CartRepositoryPort
      - name: PostgresOrderAdapter
        type: Repository
        implements: OrderRepositoryPort
      - name: StripePaymentAdapter
        type: Gateway
        implements: PaymentGatewayPort`,
  },
  {
    description:
      "Simple task management app where users can create projects, add tasks, assign them to team members, and track progress.",
    manifest: `workspace:
  name: task-management-app
  description: Collaborative task and project management

boundedContexts:
  - name: project-management
    description: Project creation and organization
    ports:
      in:
        - name: CreateProjectPort
          type: UseCase
          description: Create new project
        - name: ListProjectsPort
          type: UseCase
          description: List all projects
        - name: ArchiveProjectPort
          type: UseCase
          description: Archive completed project
      out:
        - name: ProjectRepositoryPort
          type: Repository
          description: Persist project data
    adapters:
      - name: PostgresProjectAdapter
        type: Repository
        implements: ProjectRepositoryPort

  - name: task-tracking
    description: Task creation and status management
    ports:
      in:
        - name: CreateTaskPort
          type: UseCase
          description: Create new task
        - name: UpdateTaskStatusPort
          type: UseCase
          description: Update task status
        - name: AssignTaskPort
          type: UseCase
          description: Assign task to team member
        - name: ListTasksPort
          type: UseCase
          description: List tasks with filters
      out:
        - name: TaskRepositoryPort
          type: Repository
          description: Persist task data
        - name: NotificationServicePort
          type: Service
          description: Send task notifications
    adapters:
      - name: PostgresTaskAdapter
        type: Repository
        implements: TaskRepositoryPort
      - name: EmailNotificationAdapter
        type: Service
        implements: NotificationServicePort`,
  },
  {
    description:
      "Blog platform with user accounts, post creation, comments, and content moderation.",
    manifest: `workspace:
  name: blog-platform
  description: Content publishing platform with moderation

boundedContexts:
  - name: user-accounts
    description: User registration and authentication
    ports:
      in:
        - name: RegisterUserPort
          type: UseCase
          description: Register new user
        - name: LoginPort
          type: UseCase
          description: User login
      out:
        - name: UserRepositoryPort
          type: Repository
          description: Persist user data
    adapters:
      - name: PostgresUserAdapter
        type: Repository
        implements: UserRepositoryPort

  - name: content-publishing
    description: Blog post creation and management
    ports:
      in:
        - name: CreatePostPort
          type: UseCase
          description: Create new blog post
        - name: EditPostPort
          type: UseCase
          description: Edit existing post
        - name: PublishPostPort
          type: UseCase
          description: Publish draft post
        - name: ListPostsPort
          type: UseCase
          description: List published posts
      out:
        - name: PostRepositoryPort
          type: Repository
          description: Persist post data
        - name: MediaStoragePort
          type: Service
          description: Store images and media
    adapters:
      - name: PostgresPostAdapter
        type: Repository
        implements: PostRepositoryPort
      - name: S3MediaAdapter
        type: Service
        implements: MediaStoragePort

  - name: comment-system
    description: User comments and discussions
    ports:
      in:
        - name: AddCommentPort
          type: UseCase
          description: Add comment to post
        - name: ModerateCommentPort
          type: UseCase
          description: Moderate user comment
        - name: ListCommentsPort
          type: UseCase
          description: List post comments
      out:
        - name: CommentRepositoryPort
          type: Repository
          description: Persist comment data
        - name: ModerationServicePort
          type: Service
          description: AI content moderation
    adapters:
      - name: PostgresCommentAdapter
        type: Repository
        implements: CommentRepositoryPort
      - name: OpenAIModerationAdapter
        type: Service
        implements: ModerationServicePort`,
  },
];

/**
 * Format few-shot examples for inclusion in prompt
 */
export function formatFewShotExamples(): string {
  return FEW_SHOT_EXAMPLES.map((example, index) => {
    return `Example ${index + 1}:
Description: "${example.description}"

Generated Manifest:
${example.manifest}
`;
  }).join("\n---\n\n");
}

/**
 * Get few-shot examples as a prompt section
 */
export function getFewShotPromptSection(): string {
  return `## Examples

Here are some examples of project descriptions and their corresponding manifest.yaml files:

${formatFewShotExamples()}

Now, generate a manifest for the user's project description following the same pattern.`;
}

// Made with Bob
