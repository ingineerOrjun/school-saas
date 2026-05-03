import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { AcademicSessionModule } from './academic-session/academic-session.module';
import { AnnouncementModule } from './announcement/announcement.module';
import { AuthModule } from './auth/auth.module';
import { TeacherScopeModule } from './common/auth/teacher-scope.module';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { AttendanceModule } from './attendance/attendance.module';
import { ClassModule } from './class/class.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ExamsModule } from './exams/exams.module';
import { FeesModule } from './fees/fees.module';
import { GradingModule } from './grading/grading.module';
import { PromotionModule } from './promotion/promotion.module';
import { SchoolModule } from './school/school.module';
import { SectionModule } from './section/section.module';
import { StudentModule } from './student/student.module';
import { SubjectModule } from './subject/subject.module';
import { TeacherModule } from './teacher/teacher.module';
import { TeachingAssignmentModule } from './teaching-assignment/teaching-assignment.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    // Serve uploaded school logos at /uploads/* so the frontend can
    // <img src="http://api/uploads/logos/<file>" /> them. Path resolves
    // from the project root regardless of how Nest was started.
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
      serveStaticOptions: {
        // Logos rarely change once set; cache aggressively but allow
        // revalidation so a re-upload appears within minutes.
        maxAge: '1h',
        index: false,
      },
    }),
    DatabaseModule,
    AuthModule,
    TeacherScopeModule,
    AcademicSessionModule,
    StudentModule,
    TeacherModule,
    ClassModule,
    SectionModule,
    SubjectModule,
    TeachingAssignmentModule,
    AttendanceModule,
    GradingModule,
    ExamsModule,
    FeesModule,
    DashboardModule,
    SchoolModule,
    UserModule,
    AnnouncementModule,
    PromotionModule,
    // Future feature modules will be added here
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
