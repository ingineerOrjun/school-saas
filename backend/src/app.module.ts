import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { AttendanceModule } from './attendance/attendance.module';
import { ClassModule } from './class/class.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ExamsModule } from './exams/exams.module';
import { FeesModule } from './fees/fees.module';
import { GradingModule } from './grading/grading.module';
import { SchoolModule } from './school/school.module';
import { SectionModule } from './section/section.module';
import { StudentModule } from './student/student.module';
import { TeacherModule } from './teacher/teacher.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    DatabaseModule,
    AuthModule,
    StudentModule,
    TeacherModule,
    ClassModule,
    SectionModule,
    AttendanceModule,
    GradingModule,
    ExamsModule,
    FeesModule,
    DashboardModule,
    SchoolModule,
    UserModule,
    // Future feature modules will be added here
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
